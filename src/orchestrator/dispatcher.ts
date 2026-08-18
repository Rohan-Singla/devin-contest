/**
 * The orchestrator.
 *
 * Agents run in parallel within a wave; merges happen strictly one at a time.
 * That split is the whole concurrency story: parallel where work is disjoint,
 * serial where state is shared.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createIssue,
  getProject,
  listIssues,
  updateIssue,
  updateProject,
  type Issue,
} from '../platform/db'
import { publish } from '../platform/bus'
import { addDependencies, applyPatchToBranch, initRepo, mergeBranch, revertLastMerge } from '../platform/git'
import { planProject } from './planner'
import { Preview } from './preview'
import { runWorker } from './worker'

const TEMPLATE = 'templates/base'
const MAX_PARALLEL_AGENTS = 3

/** Preview sandboxes, kept alive for the life of the process. */
const previews = new Map<string, Preview>()

export function getPreview(projectId: string): Preview | undefined {
  return previews.get(projectId)
}

export async function shutdownPreviews(): Promise<void> {
  await Promise.all([...previews.values()].map((p) => p.stop()))
  previews.clear()
}

/**
 * Build a project end to end: scaffold, plan, then execute wave by wave.
 */
export async function runProject(projectId: string): Promise<void> {
  const project = getProject(projectId)
  if (!project) throw new Error(`no such project: ${projectId}`)

  try {
    publish(projectId, null, 'project_status', { status: 'planning' })
    await initRepo(project.repoPath, TEMPLATE)
    publish(projectId, null, 'log', { message: 'repository scaffolded from template' })

    // Boot the preview while the planner thinks — both take about a minute.
    const previewBoot = Preview.start(project.repoPath, (line) =>
      publish(projectId, null, 'log', { message: line })
    )
      .then((preview) => {
        previews.set(projectId, preview)
        updateProject(projectId, {
          previewUrl: `https://${preview.url}`,
          sandboxId: preview.sandboxId,
        })
        publish(projectId, null, 'preview_ready', { url: `https://${preview.url}` })
        return preview
      })
      .catch((err) => {
        publish(projectId, null, 'log', { message: `preview failed: ${err.message}` })
        return null
      })

    const plan = await planProject(project.prompt)
    updateProject(projectId, { name: plan.name })
    for (const planned of plan.issues) {
      const issue = createIssue(projectId, planned)
      publish(projectId, issue.id, 'issue_created', issue)
    }
    publish(projectId, null, 'log', {
      message: `planned ${plan.issues.length} issues across ${
        new Set(plan.issues.map((i) => i.wave)).size
      } waves`,
    })

    const preview = await previewBoot
    updateProject(projectId, { status: 'building' })
    publish(projectId, null, 'project_status', { status: 'building' })

    await executeWaves(projectId, preview)

    updateProject(projectId, { status: 'ready' })
    publish(projectId, null, 'project_status', { status: 'ready' })
  } catch (err: any) {
    updateProject(projectId, { status: 'failed', error: err?.message ?? String(err) })
    publish(projectId, null, 'project_status', { status: 'failed', error: err?.message })
    throw err
  }
}

/** Run every pending issue, wave by wave. */
export async function executeWaves(projectId: string, preview: Preview | null): Promise<void> {
  const pending = listIssues(projectId).filter((i) => i.status === 'todo')
  const waves = [...new Set(pending.map((i) => i.wave))].sort((a, b) => a - b)

  for (const wave of waves) {
    const issues = listIssues(projectId).filter((i) => i.wave === wave && i.status === 'todo')
    if (!issues.length) continue

    publish(projectId, null, 'wave_start', { wave, count: issues.length })

    for (let i = 0; i < issues.length; i += MAX_PARALLEL_AGENTS) {
      const batch = issues.slice(i, i + MAX_PARALLEL_AGENTS)
      await Promise.all(batch.map((issue, slot) => workIssue(projectId, issue, slot, preview)))
    }

    publish(projectId, null, 'wave_end', { wave })
  }
}

/** One issue: run the agent, then hand its patch to the merge queue. */
async function workIssue(
  projectId: string,
  issue: Issue,
  slot: number,
  preview: Preview | null
): Promise<void> {
  const project = getProject(projectId)!
  updateIssue(issue.id, { status: 'running', agentSlot: slot })
  publish(projectId, issue.id, 'issue_status', { status: 'running', agentSlot: slot })

  const conventions = readFileSync(join(TEMPLATE, 'AGENTS.md'), 'utf8')

  const result = await runWorker(
    {
      issueTitle: issue.title,
      issueBody: issue.body,
      paths: issue.paths,
      conventions,
      repoPath: project.repoPath,
    },
    (event) => {
      if (event.type === 'text' && event.text) {
        publish(projectId, issue.id, 'agent_text', { slot, text: event.text })
      } else if (event.type === 'tool_start') {
        publish(projectId, issue.id, 'agent_tool', {
          slot,
          name: event.toolName,
          args: event.args,
          phase: 'start',
        })
      } else if (event.type === 'tool_end') {
        publish(projectId, issue.id, 'agent_tool', {
          slot,
          name: event.toolName,
          ok: event.ok,
          phase: 'end',
        })
      } else if (event.type === 'error') {
        publish(projectId, issue.id, 'log', { message: `agent error: ${event.text}` })
      }
    }
  )

  if (!result.ok) {
    updateIssue(issue.id, { status: 'failed', error: result.error ?? 'agent produced no changes' })
    publish(projectId, issue.id, 'issue_status', { status: 'failed', error: result.error })
    return
  }

  updateIssue(issue.id, { summary: result.summary })
  await enqueueMerge(projectId, issue, result.patch, result.dependencies, preview)
}

// ───────────────────────────────────────────────── the merge queue

/** Serialises every merge for the whole process. */
let mergeChain: Promise<unknown> = Promise.resolve()

function enqueueMerge(
  projectId: string,
  issue: Issue,
  patch: string,
  dependencies: string[],
  preview: Preview | null
): Promise<void> {
  const next = mergeChain.then(() => mergeOne(projectId, issue, patch, dependencies, preview))
  // Keep the chain alive even if one merge throws.
  mergeChain = next.catch(() => {})
  return next
}

async function mergeOne(
  projectId: string,
  issue: Issue,
  patch: string,
  dependencies: string[],
  preview: Preview | null
): Promise<void> {
  const project = getProject(projectId)!
  const branch = `issue-${issue.number}`

  updateIssue(issue.id, { status: 'merging', branch })
  publish(projectId, issue.id, 'issue_status', { status: 'merging' })

  const applied = await applyPatchToBranch(
    project.repoPath,
    branch,
    patch,
    `feat: ${issue.title}\n\ncloses #${issue.number}`
  )
  if (!applied.applied) {
    updateIssue(issue.id, { status: 'failed', error: applied.reason })
    publish(projectId, issue.id, 'issue_status', { status: 'failed', error: applied.reason })
    return
  }

  const merged = await mergeBranch(project.repoPath, branch)
  if (!merged.merged) {
    updateIssue(issue.id, {
      status: 'failed',
      error: `merge conflict in ${merged.conflicts?.join(', ') || 'unknown files'}`,
    })
    publish(projectId, issue.id, 'issue_status', {
      status: 'failed',
      error: 'merge conflict',
      conflicts: merged.conflicts,
    })
    return
  }

  // Dependencies are applied centrally so package.json is never contended.
  if (dependencies.length) {
    const added = await addDependencies(project.repoPath, dependencies)
    if (added.length) publish(projectId, issue.id, 'log', { message: `added deps: ${added.join(', ')}` })
  }

  // Verify the integrated result, not the isolated branch.
  if (preview) {
    publish(projectId, issue.id, 'log', { message: `verifying merge of #${issue.number}…` })
    const verdict = await preview.verify(project.repoPath)
    if (!verdict.ok) {
      await revertLastMerge(project.repoPath)
      await preview.sync(project.repoPath)
      updateIssue(issue.id, { status: 'failed', error: 'merged code failed the test suite' })
      publish(projectId, issue.id, 'issue_status', {
        status: 'failed',
        error: 'tests failed after merge — change reverted',
        output: verdict.output.slice(-1500),
      })
      return
    }
    await preview.startServers((line) => publish(projectId, null, 'log', { message: line }))
  }

  updateIssue(issue.id, { status: 'merged' })
  publish(projectId, issue.id, 'issue_status', { status: 'merged' })
}

/** Run a single ad-hoc issue against an existing project (the "fix this bug" path). */
export async function runSingleIssue(projectId: string, issueId: string): Promise<void> {
  const issue = listIssues(projectId).find((i) => i.id === issueId)
  if (!issue) throw new Error(`no such issue: ${issueId}`)
  await workIssue(projectId, issue, 0, getPreview(projectId) ?? null)
}

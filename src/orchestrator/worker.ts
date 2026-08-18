/**
 * One agent working one issue.
 *
 * Pi supplies the agent runtime — loop, tool calling, context compaction,
 * session history. We supply the sandbox: every tool Pi calls is rewired
 * through `e2b-ops` so all I/O happens inside a disposable cloud VM rather
 * than on this host.
 */
import {
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentSandbox, WORKDIR } from '../sandbox'
import { bashOps, editOps, lsOps, readOps, writeOps } from '../worker/e2b-ops'

export interface WorkerInput {
  issueTitle: string
  issueBody: string
  /** Glob-ish path prefixes this agent is allowed to touch. */
  paths: string[]
  /** Repo conventions (AGENTS.md), injected because Pi discovers resources host-side. */
  conventions: string
  repoPath: string
  model?: string
  maxTurns?: number
}

export interface WorkerEvent {
  type: 'text' | 'tool_start' | 'tool_end' | 'turn' | 'error'
  text?: string
  toolName?: string
  args?: unknown
  ok?: boolean
  preview?: string
}

export interface WorkerResult {
  ok: boolean
  patch: string
  summary: string
  /** npm packages the agent says it needs; applied centrally, never by the agent. */
  dependencies: string[]
  error?: string
  sandboxId: string
}

function buildPrompt(input: WorkerInput): string {
  return `${input.conventions}

---

# Your assigned issue

## ${input.issueTitle}

${input.issueBody}

## Paths you own

${input.paths.length ? input.paths.map((p) => `- \`${p}\``).join('\n') : '- (none specified — stay narrow)'}

Other agents are working in this repository right now, in other paths. Create and modify files
only inside the paths above. Anything you write outside them will be discarded when your work
is merged.

## Definition of done

1. Implement the issue.
2. Add tests for what you built, in their own file under \`test/\`.
3. Run \`npm test\` and make it pass — the whole suite, not just your file.
4. Reply with a short summary of what you changed.

If you need an npm package that is not installed, do NOT install it and do NOT edit package.json.
Name it in your summary on a line of the form \`DEPENDENCIES: package-a, package-b\` and write your
code as if it were present.

Begin.`
}

/**
 * Read the `DEPENDENCIES:` line out of an agent's summary.
 *
 * Agents habitually answer "none" or "no new dependencies", and a naive parse
 * installs a package called `none`. Anything that is not plausibly an npm name
 * is dropped.
 */
const NOT_A_PACKAGE = new Set([
  'none',
  'n/a',
  'na',
  'nil',
  'no',
  'nothing',
  'null',
  'undefined',
  'empty',
])

export function parseDependencies(summary: string): string[] {
  const line = summary.match(/^DEPENDENCIES:[ \t]*(.*)$/im)?.[1] ?? ''
  return [
    ...new Set(
      line
        .split(',')
        .map((entry) => entry.trim().replace(/^[`'"]|[`'".]$/g, ''))
        .filter((entry) => entry.length > 0 && entry.length < 80)
        .filter((entry) => !NOT_A_PACKAGE.has(entry.toLowerCase()))
        // Valid npm names: optional @scope/, lowercase, no spaces.
        .filter((entry) => /^(@[a-z0-9-~][\w.-]*\/)?[a-z0-9-~][\w.-]*(@[\w.^~>=<-]+)?$/i.test(entry))
    ),
  ]
}

export async function runWorker(
  input: WorkerInput,
  onEvent: (event: WorkerEvent) => void
): Promise<WorkerResult> {
  const sandbox = await AgentSandbox.create(input.repoPath, 20 * 60_000)

  try {
    // Install first, then snapshot — otherwise npm's lockfile lands in the
    // agent's diff and swamps the actual change.
    await sandbox.exec('npm install --silent --no-audit --no-fund', { timeoutMs: 240_000 })
    await sandbox.exec(
      'printf "node_modules/\\npackage-lock.json\\n" >> .gitignore; ' +
        'git init -q 2>/dev/null; git -c user.email=a@b -c user.name=agent add -A && ' +
        'git -c user.email=a@b -c user.name=agent commit -qm baseline || true'
    )

    const modelRuntime = await ModelRuntime.create()
    const model = modelRuntime.getModel('deepseek', input.model ?? 'deepseek-v4-pro')
    if (!model) throw new Error(`model not available: ${input.model ?? 'deepseek-v4-pro'}`)

    // Pi discovers resources (AGENTS.md, skills) from cwd. Point it at an empty
    // directory so it never picks up *this* repository's files by accident.
    const neutralCwd = mkdtempSync(join(tmpdir(), 'pi-agent-'))

    const toolOptions = { cwd: WORKDIR }
    const { session } = await createAgentSession({
      cwd: neutralCwd,
      model,
      thinkingLevel: 'medium',
      modelRuntime,
      sessionManager: SessionManager.inMemory(),
      // Disable Pi's local-filesystem tools, then re-register the same tools
      // pointed at the sandbox.
      noTools: 'builtin',
      // Each factory returns a narrowly-typed ToolDefinition; the array they go
      // into is invariant, so widen at the boundary.
      customTools: [
        createBashToolDefinition(toolOptions.cwd, { operations: bashOps(sandbox) }),
        createReadToolDefinition(toolOptions.cwd, { operations: readOps(sandbox) }),
        createWriteToolDefinition(toolOptions.cwd, { operations: writeOps(sandbox) }),
        createEditToolDefinition(toolOptions.cwd, { operations: editOps(sandbox) }),
        createLsToolDefinition(toolOptions.cwd, { operations: lsOps(sandbox) }),
      ] as ToolDefinition[],
      tools: ['bash', 'read', 'write', 'edit', 'ls'],
    })

    let assistantText = ''
    session.subscribe((event: any) => {
      try {
        if (event.type === 'message_update') {
          const inner = event.assistantMessageEvent
          if (inner?.type === 'text_delta' && inner.delta) {
            assistantText += inner.delta
            onEvent({ type: 'text', text: inner.delta })
          }
        } else if (event.type === 'tool_execution_start') {
          onEvent({ type: 'tool_start', toolName: event.toolName, args: event.args ?? event.input })
        } else if (event.type === 'tool_execution_end') {
          onEvent({
            type: 'tool_end',
            toolName: event.toolName,
            ok: !event.isError,
            preview: typeof event.result === 'string' ? event.result.slice(0, 300) : undefined,
          })
        } else if (event.type === 'turn_start') {
          onEvent({ type: 'turn' })
        }
      } catch {
        /* never let a UI event break the run */
      }
    })

    await session.prompt(buildPrompt(input))

    const patch = await sandbox.diff()
    const summary = assistantText.trim().slice(-4000)
    const dependencies = parseDependencies(summary)

    return {
      ok: patch.trim().length > 0,
      patch,
      summary: summary || '(no summary)',
      dependencies,
      error: patch.trim() ? undefined : 'agent finished without changing any files',
      sandboxId: sandbox.id,
    }
  } catch (err: any) {
    onEvent({ type: 'error', text: err?.message ?? String(err) })
    return {
      ok: false,
      patch: '',
      summary: '',
      dependencies: [],
      error: err?.message ?? String(err),
      sandboxId: sandbox.id,
    }
  } finally {
    await sandbox.kill().catch(() => {})
  }
}

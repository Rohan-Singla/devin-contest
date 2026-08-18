#!/usr/bin/env bun
/**
 * CLI: point the agent at a local repo with a task.
 *
 *   bun run src/index.ts --repo ./benchmark/buggy-repo --task "This repo has 3 bugs. Find and fix them."
 */
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { runAgent } from './agent'
import { makeClient, MODELS, type ModelName } from './llm'
import { AgentSandbox } from './sandbox'
import { emit, initTrace } from './trace'
import { reportVerdict, verify } from './verify'

const { values } = parseArgs({
  options: {
    repo: { type: 'string', short: 'r' },
    task: { type: 'string', short: 't' },
    model: { type: 'string', short: 'm', default: 'pro' },
    'max-turns': { type: 'string', default: '50' },
    trace: { type: 'string' },
    'save-patch': { type: 'string' },
    verify: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !values.repo || !values.task) {
  console.log(`
mini-devin — an autonomous coding agent in a sandbox

  --repo, -r        Path to the local repository to work on   (required)
  --task, -t        What the agent should do                  (required)
  --model, -m       'pro' (default) or 'flash'
  --max-turns       Turn budget before giving up (default 50)
  --trace           Write a JSONL trace here (default traces/<timestamp>.jsonl)
  --save-patch      Write the agent's final diff to this file
  --verify          Test command the harness runs to grade the result,
                    e.g. --verify "npm test". Also flags edited test files.
`)
  process.exit(values.help ? 0 : 1)
}

const repoPath = resolve(values.repo)
if (!existsSync(repoPath)) {
  console.error(`No such directory: ${repoPath}`)
  process.exit(1)
}

const model: ModelName =
  values.model === 'flash' ? MODELS.flash : values.model === 'pro' ? MODELS.pro : (values.model as ModelName)

const tracePath = values.trace ?? `traces/${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
initTrace(tracePath)

const client = makeClient()

emit({ type: 'task', task: values.task, repo: repoPath })

const sandbox = await AgentSandbox.create(repoPath)
emit({ type: 'sandbox', sandboxId: sandbox.id })

// Snapshot the starting state so we can diff whatever the agent changes.
await sandbox.exec(
  'git init -q 2>/dev/null; git -c user.email=a@b -c user.name=agent add -A && ' +
    'git -c user.email=a@b -c user.name=agent commit -qm baseline || true'
)

let exitCode = 0
try {
  const result = await runAgent({
    task: values.task,
    sandbox,
    client,
    model,
    maxTurns: Number(values['max-turns']),
  })

  const patch = await sandbox.diff()
  if (values['save-patch']) {
    writeFileSync(values['save-patch'], patch + '\n')
    console.log(`patch → ${values['save-patch']}`)
  }
  console.log(
    `\ntokens: ${result.usage.input} in / ${result.usage.output} out · trace → ${tracePath}`
  )
  if (!patch) console.log('(the agent made no file changes)')

  exitCode = result.reason === 'submitted' ? 0 : 1

  if (values.verify) {
    const solved = reportVerdict(await verify(sandbox, values.verify))
    exitCode = solved ? 0 : 1
  }
} catch (err: any) {
  emit({ type: 'error', message: err?.message ?? String(err) })
  exitCode = 1
} finally {
  await sandbox.kill()
}

process.exit(exitCode)

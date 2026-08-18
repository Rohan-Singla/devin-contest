#!/usr/bin/env bun
/**
 * Pre-flight check. Exercises every external boundary once, cheaply, so a
 * failure names one thing instead of "the build didn't work".
 *
 * Run this before a demo.
 */
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { rmSync } from 'node:fs'
import { complete, makeClient, MODELS } from '../src/llm'
import { AgentSandbox } from '../src/sandbox'
import { bashOps, lsOps, readOps } from '../src/worker/e2b-ops'
import { initRepo, trackedFiles } from '../src/platform/git'
import { deconflict } from '../src/orchestrator/planner'

const ok = (s: string) => console.log(`\x1b[32m  ✓\x1b[0m ${s}`)
const bad = (s: string) => console.log(`\x1b[31m  ✗\x1b[0m ${s}`)
const step = (s: string) => console.log(`\n\x1b[1m▌ ${s}\x1b[0m`)

let failures = 0
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok(pass) : (failures++, bad(fail))

// ───────────────────────────────────────────── 1. planner model
step('DeepSeek — the planner\'s model')
try {
  const res = await complete(makeClient(), {
    model: MODELS.flash,
    maxTokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
  })
  const text = res.choices[0]?.message.content ?? ''
  check(text.includes('PONG'), `reachable (${res.usage?.total_tokens} tok)`, `odd reply: ${text}`)
} catch (err: any) {
  failures++
  bad(`request failed: ${err?.status ?? ''} ${err?.message}`)
}

// ───────────────────────────────────────────── 2. Pi's model runtime
step('Pi — agent runtime and model resolution')
try {
  const runtime = await ModelRuntime.create()
  const model = runtime.getModel('deepseek', MODELS.pro)
  check(!!model, `pi resolves ${MODELS.pro}`, `pi cannot resolve ${MODELS.pro}`)
  const auth = await runtime.checkAuth('deepseek').catch(() => undefined)
  check(auth !== undefined, 'deepseek credentials visible to pi', 'pi sees no deepseek credentials')
} catch (err: any) {
  failures++
  bad(`pi runtime failed: ${err?.message}`)
}

// ───────────────────────────────────────────── 3. planner logic (offline)
step('Planner — conflict resolution')
{
  const planned = deconflict([
    { title: 'a', body: '', wave: 0, paths: ['server/routes/x.js'], dependencies: [] },
    { title: 'b', body: '', wave: 0, paths: ['server/routes/x.js'], dependencies: [] },
  ])
  check(
    planned[0]!.wave !== planned[1]!.wave,
    'issues claiming the same file are split across waves',
    'two issues in one wave still claim the same file'
  )

  const guarded = deconflict([
    { title: 'c', body: '', wave: 0, paths: ['server/index.js'], dependencies: [] },
  ])
  check(
    guarded[0]!.paths.length === 0,
    'shared files are stripped from issue ownership',
    'an issue was allowed to own server/index.js'
  )
}

// ───────────────────────────────────────────── 4. repo scaffolding
step('Git — project scaffolding')
const repoPath = 'data/smoke-repo'
try {
  rmSync(repoPath, { recursive: true, force: true })
  await initRepo(repoPath, 'templates/base')
  const files = await trackedFiles(repoPath)
  check(files.length > 5, `template committed (${files.length} files)`, 'template did not commit')
  check(
    files.some((f) => f.path === 'AGENTS.md'),
    'conventions file present',
    'AGENTS.md missing — agents will not know the rules'
  )
} catch (err: any) {
  failures++
  bad(`scaffolding failed: ${err?.message}`)
}

// ───────────────────────────────────────────── 5. sandbox + Pi's tool ops
step('E2B — sandbox and the operations backing Pi\'s tools')
let sandbox: AgentSandbox | null = null
try {
  sandbox = await AgentSandbox.create(repoPath)
  ok(`sandbox created (${sandbox.id})`)

  const node = await sandbox.exec('node --version')
  check(node.exitCode === 0, `node present (${node.stdout.trim()})`, 'node missing in template')

  const failing = await sandbox.exec('exit 3')
  check(failing.exitCode === 3, 'non-zero exits captured, not thrown', `exit code lost: ${failing.exitCode}`)

  // The three operation sets Pi's read / ls / bash tools run through.
  const contents = await readOps(sandbox).readFile('/home/user/repo/package.json')
  check(contents.toString().includes('generated-app'), 'read operations work', 'read operations failed')

  const entries = await lsOps(sandbox).readdir('/home/user/repo/server')
  check(entries.includes('index.js'), 'ls operations work', `ls operations failed: ${entries}`)

  let streamed = ''
  const result = await bashOps(sandbox).exec('echo hello-from-sandbox', '/home/user/repo', {
    onData: (chunk) => (streamed += chunk.toString()),
  })
  check(
    result.exitCode === 0 && streamed.includes('hello-from-sandbox'),
    'bash operations stream output',
    `bash operations failed: ${streamed}`
  )
} catch (err: any) {
  failures++
  bad(`sandbox failed: ${err?.message}`)
} finally {
  await sandbox?.kill().catch(() => {})
  rmSync(repoPath, { recursive: true, force: true })
  ok('cleaned up')
}

console.log(
  failures === 0
    ? `\n\x1b[32m\x1b[1m▌ ALL CLEAR\x1b[0m — run \x1b[1mbun run dev\x1b[0m\n`
    : `\n\x1b[31m\x1b[1m▌ ${failures} CHECK(S) FAILED\x1b[0m\n`
)
process.exit(failures === 0 ? 0 : 1)

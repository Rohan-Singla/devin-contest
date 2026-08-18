#!/usr/bin/env bun
/** Integration check: one Pi agent, one issue, tools running inside E2B. */
import { rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { initRepo } from '../src/platform/git'
import { runWorker } from '../src/orchestrator/worker'

const repoPath = 'data/test-repo'
rmSync(repoPath, { recursive: true, force: true })
await initRepo(repoPath, 'templates/base')
console.log('repo seeded at', repoPath)

const result = await runWorker(
  {
    issueTitle: 'Add a products API',
    issueBody:
      'Expose GET /api/products returning a hardcoded list of 3 products, each with id, name and price.',
    paths: ['server/routes/products.js', 'test/products.test.js'],
    conventions: readFileSync('templates/base/AGENTS.md', 'utf8'),
    repoPath,
  },
  (e) => {
    if (e.type === 'text' && e.text) process.stdout.write(e.text)
    if (e.type === 'tool_start') console.log(`\n\x1b[33m→ ${e.toolName}\x1b[0m`, JSON.stringify(e.args)?.slice(0, 140))
    if (e.type === 'tool_end') console.log(`\x1b[90m  ${e.ok ? '✓' : '✗'} ${e.preview?.slice(0, 140) ?? ''}\x1b[0m`)
    if (e.type === 'error') console.log(`\n\x1b[31m! ${e.text}\x1b[0m`)
  }
)

console.log('\n\n─────── RESULT ───────')
console.log('ok:', result.ok)
console.log('error:', result.error ?? 'none')
console.log('dependencies:', result.dependencies)
console.log('files changed:')
for (const line of result.patch.split('\n').filter((l) => l.startsWith('+++ ') || l.startsWith('--- '))) {
  console.log('  ', line)
}
console.log('patch size:', result.patch.length, 'chars')

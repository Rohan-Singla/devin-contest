#!/usr/bin/env bun
/**
 * Pre-flight check. Exercises every network boundary once, cheaply, so a
 * failure points at one thing instead of at "the agent didn't work".
 *
 *   bun run smoke
 */
import { AgentSandbox, WORKDIR } from '../src/sandbox'
import { complete, makeClient, MODELS, reasoningOf } from '../src/llm'
import { runTool, type ToolContext } from '../src/tools'

const ok = (s: string) => console.log(`\x1b[32m  ✓\x1b[0m ${s}`)
const bad = (s: string) => console.log(`\x1b[31m  ✗\x1b[0m ${s}`)
const step = (s: string) => console.log(`\n\x1b[1m▌ ${s}\x1b[0m`)

let failures = 0
function check(cond: boolean, pass: string, fail: string) {
  cond ? ok(pass) : (failures++, bad(fail))
}

// ─────────────────────────────────────────── 1. DeepSeek: plain completion
step('DeepSeek — basic completion')
const client = makeClient()
try {
  const res = await complete(client, {
    model: MODELS.flash,
    tools: false,
    maxTokens: 64,
    messages: [{ role: 'user', content: 'Reply with exactly: PONG' }],
  })
  const text = res.choices[0]?.message.content ?? ''
  check(text.includes('PONG'), `model replied (${res.usage?.total_tokens} tok)`, `unexpected reply: ${text}`)
} catch (err: any) {
  failures++
  bad(`request failed: ${err?.status ?? ''} ${err?.message}`)
}

// ─────────────────────────────────────────── 2. DeepSeek: tool calling
step('DeepSeek — tool calling (the shape the agent depends on)')
try {
  const res = await complete(client, {
    model: MODELS.pro,
    maxTokens: 512,
    messages: [
      { role: 'system', content: 'You are testing tools. Use them immediately, without preamble.' },
      { role: 'user', content: 'Read the file src/cart.js and nothing else.' },
    ],
  })
  const msg = res.choices[0]!.message
  const calls = msg.tool_calls ?? []
  check(calls.length > 0, `returned ${calls.length} tool_call(s)`, 'returned NO tool_calls — the agent loop cannot work')

  if (calls[0]) {
    const c = calls[0]
    check(c.type === 'function', `type is "function"`, `unexpected call type: ${c.type}`)
    check(typeof c.id === 'string' && c.id.length > 0, `call id present (${c.id})`, 'missing tool_call id')
    const fn = (c as any).function
    check(fn?.name === 'read_file', `called read_file`, `called "${fn?.name}" instead of read_file`)
    try {
      const args = JSON.parse(fn.arguments)
      check(typeof args.path === 'string', `arguments parse as JSON (path=${args.path})`, 'arguments missing "path"')
    } catch {
      failures++
      bad(`arguments were not valid JSON: ${fn?.arguments?.slice(0, 120)}`)
    }
  }
  check(reasoningOf(msg) !== undefined, 'reasoning field readable', 'reasoning field unreadable')

  // The round trip: send a tool result back and confirm the API accepts it.
  const followUp = await complete(client, {
    model: MODELS.pro,
    maxTokens: 256,
    messages: [
      { role: 'system', content: 'You are testing tools.' },
      { role: 'user', content: 'Read the file src/cart.js and nothing else.' },
      { role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls },
      ...calls.map((c) => ({
        role: 'tool' as const,
        tool_call_id: c.id,
        content: 'export const x = 1',
      })),
    ],
  })
  check(!!followUp.choices[0], 'tool results accepted on the round trip', 'round trip rejected')
} catch (err: any) {
  failures++
  bad(`tool calling failed: ${err?.status ?? ''} ${err?.message}`)
}

// ─────────────────────────────────────────── 3. E2B sandbox
step('E2B — sandbox lifecycle')
let sandbox: AgentSandbox | null = null
try {
  sandbox = await AgentSandbox.create('./benchmark/buggy-repo')
  ok(`sandbox created (${sandbox.id})`)

  const ls = await sandbox.exec('ls')
  check(ls.stdout.includes('package.json'), 'repo uploaded and visible', `upload looks wrong: ${ls.stdout}`)

  const node = await sandbox.exec('node --version')
  check(node.exitCode === 0, `node present (${node.stdout.trim()})`, 'node missing in sandbox template')

  const major = Number(node.stdout.trim().replace(/^v/, '').split('.')[0])
  check(major >= 18, `node ${major} supports --test`, `node ${major} is too old for the benchmark's test runner`)

  const tests = await sandbox.exec('npm test')
  check(
    tests.exitCode !== 0,
    'benchmark suite fails as expected (bugs are present)',
    'benchmark suite PASSES before any fix — the planted bugs are missing'
  )

  const failCount = (tests.stdout + tests.stderr).match(/# fail (\d+)/)?.[1]
  check(failCount === '4', `4 failing tests, as designed`, `expected 4 failing tests, saw ${failCount ?? 'unknown'}`)

  // Non-zero exits must be captured, not thrown — the agent needs to read them.
  const failing = await sandbox.exec('exit 3')
  check(failing.exitCode === 3, 'non-zero exit codes are captured, not thrown', `exit code lost: ${failing.exitCode}`)

  step('Tool handlers — against the real sandbox')
  const ctx: ToolContext = { sandbox }
  const read = await runTool('read_file', JSON.stringify({ path: 'src/cart.js' }), ctx)
  check(read.ok && read.output.includes('subtotal'), 'read_file works', `read_file failed: ${read.output.slice(0, 120)}`)

  const found = await runTool('search', JSON.stringify({ pattern: 'paginate' }), ctx)
  check(found.ok && found.output.includes('cart.js'), 'search works', `search failed: ${found.output.slice(0, 120)}`)

  const listed = await runTool('list_files', '{}', ctx)
  check(listed.output.includes('src/cart.js'), 'list_files works', `list_files failed: ${listed.output.slice(0, 120)}`)

  const edited = await runTool(
    'edit_file',
    JSON.stringify({ path: 'src/cart.js', old_string: 'const FREE_SHIPPING_THRESHOLD = 50', new_string: 'const FREE_SHIPPING_THRESHOLD = 51' }),
    ctx
  )
  check(edited.ok, 'edit_file works', `edit_file failed: ${edited.output.slice(0, 120)}`)

  const diff = await sandbox.exec('git init -q 2>/dev/null; git -c user.email=a@b -c user.name=t add -A && git diff --cached --stat')
  check(diff.stdout.includes('cart.js'), 'git diff captures agent changes', 'diff did not see the edit')
} catch (err: any) {
  failures++
  bad(`sandbox failed: ${err?.message}`)
} finally {
  if (sandbox) {
    await sandbox.kill()
    ok('sandbox destroyed')
  }
}

console.log(
  failures === 0
    ? `\n\x1b[32m\x1b[1m▌ ALL CLEAR\x1b[0m — run \x1b[1mbun run demo\x1b[0m\n`
    : `\n\x1b[31m\x1b[1m▌ ${failures} CHECK(S) FAILED\x1b[0m — fix these before the full run\n`
)
process.exit(failures === 0 ? 0 : 1)

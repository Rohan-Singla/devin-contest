/**
 * Offline tests for the tool layer — no network, no sandbox, no API keys.
 * Runs the real handlers against an in-memory fake of AgentSandbox.
 */
import { describe, expect, test } from 'bun:test'
import { runTool, TOOL_SPECS, type ToolContext } from './tools'
import type { AgentSandbox } from './sandbox'

function fakeSandbox(files: Record<string, string> = {}) {
  return {
    files,
    resolve: (p: string) => (p.startsWith('/') ? p : `/home/user/repo/${p}`),
    async readFile(p: string) {
      const key = p.replace(/^\/home\/user\/repo\//, '')
      if (!(key in files)) throw new Error('ENOENT')
      return files[key]!
    },
    async writeFile(p: string, data: string) {
      files[p.replace(/^\/home\/user\/repo\//, '')] = data
    },
    async exec(cmd: string) {
      return { exitCode: 0, stdout: `ran: ${cmd}`, stderr: '' }
    },
  }
}

function ctxWith(files: Record<string, string> = {}): ToolContext & { sandbox: any } {
  return { sandbox: fakeSandbox(files) as unknown as AgentSandbox } as any
}

describe('tool specs', () => {
  test('every tool declares a name, description and object schema', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.type).toBe('function')
      expect(spec.function.name).toMatch(/^[a-z_]+$/)
      expect(spec.function.description!.length).toBeGreaterThan(20)
      expect((spec.function.parameters as any).type).toBe('object')
    }
  })

  test('tool names are unique', () => {
    const names = TOOL_SPECS.map((s) => s.function.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('edit_file', () => {
  test('replaces a unique string', async () => {
    const ctx = ctxWith({ 'a.js': 'const x = 1\nconst y = 2\n' })
    const res = await runTool('edit_file', JSON.stringify({
      path: 'a.js', old_string: 'const x = 1', new_string: 'const x = 42',
    }), ctx)
    expect(res.ok).toBe(true)
    expect(ctx.sandbox.files['a.js']).toBe('const x = 42\nconst y = 2\n')
  })

  test('refuses an ambiguous match instead of guessing', async () => {
    const ctx = ctxWith({ 'a.js': 'foo\nfoo\n' })
    const res = await runTool('edit_file', JSON.stringify({
      path: 'a.js', old_string: 'foo', new_string: 'bar',
    }), ctx)
    expect(res.ok).toBe(false)
    expect(res.output).toContain('appears 2 times')
    expect(ctx.sandbox.files['a.js']).toBe('foo\nfoo\n')
  })

  test('reports a missing match rather than silently succeeding', async () => {
    const ctx = ctxWith({ 'a.js': 'foo\n' })
    const res = await runTool('edit_file', JSON.stringify({
      path: 'a.js', old_string: 'nope', new_string: 'bar',
    }), ctx)
    expect(res.ok).toBe(false)
    expect(res.output).toContain('not found')
  })
})

describe('read_file', () => {
  test('adds 1-indexed line numbers', async () => {
    const ctx = ctxWith({ 'a.js': 'alpha\nbravo\ncharlie' })
    const res = await runTool('read_file', JSON.stringify({ path: 'a.js' }), ctx)
    expect(res.output).toContain('1\talpha')
    expect(res.output).toContain('3\tcharlie')
  })

  test('honours offset and limit and flags the remainder', async () => {
    const ctx = ctxWith({ 'a.js': Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n') })
    const res = await runTool('read_file', JSON.stringify({ path: 'a.js', offset: 10, limit: 5 }), ctx)
    expect(res.output).toContain('10\tline10')
    expect(res.output).toContain('14\tline14')
    expect(res.output).not.toContain('line15\n')
    expect(res.output).toContain('more lines')
  })

  test('returns an error for a missing file', async () => {
    const res = await runTool('read_file', JSON.stringify({ path: 'ghost.js' }), ctxWith())
    expect(res.ok).toBe(false)
  })
})

describe('dispatch', () => {
  test('rejects an unknown tool', async () => {
    const res = await runTool('definitely_not_a_tool', '{}', ctxWith())
    expect(res.ok).toBe(false)
    expect(res.output).toContain('unknown tool')
  })

  test('rejects malformed JSON arguments without throwing', async () => {
    const res = await runTool('read_file', '{not json', ctxWith())
    expect(res.ok).toBe(false)
    expect(res.output).toContain('not valid JSON')
  })

  test('submit records the summary and ends the run', async () => {
    const ctx = ctxWith()
    const res = await runTool('submit', JSON.stringify({ summary: 'fixed it' }), ctx)
    expect(res.ok).toBe(true)
    expect(ctx.submission?.summary).toBe('fixed it')
  })
})

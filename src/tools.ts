/**
 * The agent's capability surface. Each tool is a JSON-schema declaration the
 * model sees, plus a handler that runs against the sandbox.
 */
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import { AgentSandbox, WORKDIR } from './sandbox'

export interface ToolContext {
  sandbox: AgentSandbox
  /** Set by the `submit` tool to end the loop. */
  submission?: { summary: string }
}

export interface Tool {
  spec: ChatCompletionFunctionTool
  run(args: any, ctx: ToolContext): Promise<string>
}

/** Tool output cap — keeps one runaway `cat` from eating the context window. */
const MAX_OUTPUT_CHARS = 12_000

function clip(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s
  const head = s.slice(0, Math.floor(max * 0.7))
  const tail = s.slice(-Math.floor(max * 0.25))
  return `${head}\n\n… [${s.length - head.length - tail.length} chars truncated] …\n\n${tail}`
}

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[]
): ChatCompletionFunctionTool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  }
}

const listFiles: Tool = {
  spec: def(
    'list_files',
    'List the repository file tree. Use this first to orient yourself in an unfamiliar codebase.',
    {
      path: { type: 'string', description: 'Directory relative to repo root. Defaults to root.' },
      depth: { type: 'number', description: 'Max depth to descend. Default 3.' },
    },
    []
  ),
  async run({ path = '.', depth = 3 }, { sandbox }) {
    const target = sandbox.resolve(path)
    const res = await sandbox.exec(
      `find ${JSON.stringify(target)} -maxdepth ${depth} ` +
        `-not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' ` +
        `| sort | sed 's|^${WORKDIR}/||'`
    )
    return clip(res.stdout || '(empty)')
  },
}

const readFile: Tool = {
  spec: def(
    'read_file',
    'Read a file with 1-indexed line numbers. Read before you edit — you need exact text to match against.',
    {
      path: { type: 'string', description: 'File path relative to repo root.' },
      offset: { type: 'number', description: 'First line to read (1-indexed).' },
      limit: { type: 'number', description: 'How many lines to read. Default 400.' },
    },
    ['path']
  ),
  async run({ path, offset = 1, limit = 400 }, { sandbox }) {
    let content: string
    try {
      content = await sandbox.readFile(path)
    } catch {
      return `Error: no such file: ${path}`
    }
    const lines = content.split('\n')
    const start = Math.max(0, offset - 1)
    const slice = lines.slice(start, start + limit)
    const width = String(start + slice.length).length
    const body = slice
      .map((l, i) => `${String(start + i + 1).padStart(width)}\t${l}`)
      .join('\n')
    const more =
      start + slice.length < lines.length
        ? `\n… ${lines.length - start - slice.length} more lines (file has ${lines.length})`
        : ''
    return clip(body + more)
  },
}

const search: Tool = {
  spec: def(
    'search',
    'Search file contents by regular expression across the repo. Returns matching lines with file:line prefixes.',
    {
      pattern: { type: 'string', description: 'Extended regular expression (grep -E).' },
      path: { type: 'string', description: 'Directory or file to search. Defaults to repo root.' },
      glob: { type: 'string', description: "Filter filenames, e.g. '*.ts'." },
    },
    ['pattern']
  ),
  async run({ pattern, path = '.', glob }, { sandbox }) {
    const include = glob ? `--include=${JSON.stringify(glob)}` : ''
    const res = await sandbox.exec(
      `grep -rnE ${JSON.stringify(pattern)} ${JSON.stringify(sandbox.resolve(path))} ` +
        `${include} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist ` +
        `| sed 's|^${WORKDIR}/||' | head -200`
    )
    return clip(res.stdout || `No matches for /${pattern}/`)
  },
}

const writeFile: Tool = {
  spec: def(
    'write_file',
    'Create a new file or completely overwrite an existing one. To change part of a file, prefer edit_file.',
    {
      path: { type: 'string', description: 'File path relative to repo root.' },
      content: { type: 'string', description: 'Full file contents.' },
    },
    ['path', 'content']
  ),
  async run({ path, content }, { sandbox }) {
    await sandbox.writeFile(path, content)
    return `Wrote ${content.split('\n').length} lines to ${path}`
  },
}

const editFile: Tool = {
  spec: def(
    'edit_file',
    'Replace an exact string in a file. old_string must appear exactly once — include surrounding lines to disambiguate.',
    {
      path: { type: 'string', description: 'File path relative to repo root.' },
      old_string: { type: 'string', description: 'Exact text to replace, including indentation.' },
      new_string: { type: 'string', description: 'Replacement text.' },
    },
    ['path', 'old_string', 'new_string']
  ),
  async run({ path, old_string, new_string }, { sandbox }) {
    let content: string
    try {
      content = await sandbox.readFile(path)
    } catch {
      return `Error: no such file: ${path}`
    }
    const occurrences = content.split(old_string).length - 1
    if (occurrences === 0) {
      return `Error: old_string not found in ${path}. Re-read the file — whitespace must match exactly.`
    }
    if (occurrences > 1) {
      return `Error: old_string appears ${occurrences} times in ${path}. Add surrounding context to make it unique.`
    }
    await sandbox.writeFile(path, content.replace(old_string, new_string))
    return `Edited ${path}`
  },
}

const runCommand: Tool = {
  spec: def(
    'run_command',
    'Run a shell command in the repo root inside the sandbox. Use for installing deps, running tests, git, anything.',
    {
      command: { type: 'string', description: 'Shell command to execute.' },
      timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Default 120000.' },
    },
    ['command']
  ),
  async run({ command, timeout_ms }, { sandbox }) {
    const res = await sandbox.exec(command, { timeoutMs: timeout_ms })
    const parts = [`exit code: ${res.exitCode}`]
    if (res.stdout.trim()) parts.push(`stdout:\n${res.stdout}`)
    if (res.stderr.trim()) parts.push(`stderr:\n${res.stderr}`)
    if (!res.stdout.trim() && !res.stderr.trim()) parts.push('(no output)')
    return clip(parts.join('\n'))
  },
}

const submit: Tool = {
  spec: def(
    'submit',
    'Call this only once the task is complete and you have verified it by running the tests. Ends the session.',
    {
      summary: {
        type: 'string',
        description: 'What was wrong, what you changed, and the evidence that it works.',
      },
    },
    ['summary']
  ),
  async run({ summary }, ctx) {
    ctx.submission = { summary }
    return 'Submitted.'
  },
}

export const TOOLS: Tool[] = [
  listFiles,
  readFile,
  search,
  writeFile,
  editFile,
  runCommand,
  submit,
]

export const TOOL_SPECS = TOOLS.map((t) => t.spec)

const BY_NAME = new Map(TOOLS.map((t) => [t.spec.function.name, t]))

export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext
): Promise<{ ok: boolean; output: string }> {
  const tool = BY_NAME.get(name)
  if (!tool) return { ok: false, output: `Error: unknown tool "${name}"` }

  let args: unknown
  try {
    args = rawArgs.trim() ? JSON.parse(rawArgs) : {}
  } catch {
    return { ok: false, output: `Error: arguments were not valid JSON: ${rawArgs.slice(0, 200)}` }
  }

  try {
    const output = await tool.run(args, ctx)
    return { ok: !output.startsWith('Error:'), output }
  } catch (err: any) {
    return { ok: false, output: `Error: ${err?.message ?? String(err)}` }
  }
}

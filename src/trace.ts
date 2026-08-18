/**
 * Trace: human-readable streaming output + a machine-readable JSONL log.
 * The JSONL file is what you replay when demoing "what did the agent actually do".
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const

export type TraceEvent =
  | { type: 'task'; task: string; repo: string }
  | { type: 'sandbox'; sandboxId: string }
  | { type: 'turn'; n: number; inputTokens: number; outputTokens: number }
  | { type: 'thinking'; text: string }
  | { type: 'say'; text: string }
  | { type: 'tool_call'; name: string; args: unknown; id: string }
  | { type: 'tool_result'; id: string; ok: boolean; preview: string; ms: number }
  | { type: 'compact'; droppedTurns: number; keptTokens: number }
  | { type: 'done'; reason: string; summary?: string; turns: number }
  | { type: 'error'; message: string }

let logPath: string | null = null

export function initTrace(path: string) {
  logPath = path
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, '')
}

function persist(e: TraceEvent) {
  if (!logPath) return
  appendFileSync(logPath, JSON.stringify({ ts: Date.now(), ...e }) + '\n')
}

function truncate(s: string, n: number) {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? flat.slice(0, n) + '…' : flat
}

export function emit(e: TraceEvent) {
  persist(e)
  switch (e.type) {
    case 'task':
      console.log(`\n${C.bold}${C.magenta}▌ TASK${C.reset} ${e.task}`)
      console.log(`${C.gray}  repo: ${e.repo}${C.reset}`)
      break
    case 'sandbox':
      console.log(`${C.gray}  sandbox: ${e.sandboxId}${C.reset}\n`)
      break
    case 'turn':
      console.log(
        `${C.dim}${C.blue}── turn ${e.n} ${C.gray}(in ${e.inputTokens} / out ${e.outputTokens} tok)${C.reset}`
      )
      break
    case 'thinking':
      if (e.text.trim()) console.log(`${C.gray}  ⋯ ${truncate(e.text, 240)}${C.reset}`)
      break
    case 'say':
      if (e.text.trim()) console.log(`${C.cyan}  ${e.text.trim()}${C.reset}`)
      break
    case 'tool_call':
      console.log(
        `  ${C.yellow}→ ${e.name}${C.reset} ${C.gray}${truncate(JSON.stringify(e.args), 160)}${C.reset}`
      )
      break
    case 'tool_result':
      console.log(
        `  ${e.ok ? C.green + '✓' : C.red + '✗'}${C.reset} ${C.gray}${truncate(e.preview, 160)} (${e.ms}ms)${C.reset}`
      )
      break
    case 'compact':
      console.log(
        `${C.dim}${C.magenta}  ⟳ compacted ${e.droppedTurns} turns → ~${e.keptTokens} tok${C.reset}`
      )
      break
    case 'done':
      console.log(
        `\n${C.bold}${e.reason === 'submitted' ? C.green : C.yellow}▌ DONE${C.reset} (${e.reason}, ${e.turns} turns)`
      )
      if (e.summary) console.log(`${e.summary}\n`)
      break
    case 'error':
      console.log(`  ${C.red}! ${e.message}${C.reset}`)
      break
  }
}

#!/usr/bin/env bun
/** Runs the orchestrator and the dashboard together, with prefixed output. */
import { spawn, spawnSync } from 'node:child_process'

const SERVER_PORT = Number(process.env.PORT ?? 4000)
const WEB_PORT = 3000

/** PIDs listening on a port, if any. */
function holders(port: number): string[] {
  const res = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  return (res.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
}

function describe(pid: string): string {
  const res = spawnSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' })
  return (res.stdout ?? '').trim().slice(0, 70) || 'unknown process'
}

/**
 * A stale process from a previous run is the single most common way this fails,
 * and the raw EADDRINUSE stack trace explains none of it. Check first, and offer
 * to clear our own leftovers.
 */
function ensurePortFree(port: number, label: string): boolean {
  const pids = holders(port)
  if (!pids.length) return true

  console.error(`\n  Port ${port} (${label}) is already in use:`)
  for (const pid of pids) console.error(`    pid ${pid}  ${describe(pid)}`)

  const ours = pids.filter((pid) => /mini-devin|devin-contest|next-server|src\/server\.ts/.test(describe(pid)))
  if (ours.length === pids.length && process.argv.includes('--force')) {
    for (const pid of ours) {
      console.error(`    → killing ${pid}`)
      spawnSync('kill', ['-9', pid])
    }
    return true
  }

  console.error(
    ours.length === pids.length
      ? `\n  These look like a previous run. Re-run with:  bun run dev --force\n`
      : `\n  Free it with:  kill -9 ${pids.join(' ')}\n` +
        (port === 5000 ? '  (on macOS, port 5000 is AirPlay Receiver)\n' : '')
  )
  return false
}

const ready =
  [
    ensurePortFree(SERVER_PORT, 'orchestrator'),
    ensurePortFree(WEB_PORT, 'dashboard'),
  ].every(Boolean)

if (!ready) process.exit(1)

const services = [
  { name: 'server', color: '\x1b[36m', cmd: ['bun', 'run', 'src/server.ts'], cwd: '.' },
  { name: 'web   ', color: '\x1b[35m', cmd: ['bun', 'run', 'dev'], cwd: 'web' },
]

const children = services.map(({ name, color, cmd, cwd }) => {
  const child = spawn(cmd[0]!, cmd.slice(1), { cwd, env: process.env })
  const prefix = `${color}${name}\x1b[0m │ `
  const pipe = (stream: NodeJS.ReadableStream) =>
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stdout.write(prefix + line + '\n')
      }
    })
  pipe(child.stdout!)
  pipe(child.stderr!)

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stdout.write(`${prefix}exited with code ${code}\n`)
    }
  })
  return child
})

console.log(`\n  dashboard    → http://localhost:${WEB_PORT}`)
console.log(`  orchestrator → http://localhost:${SERVER_PORT}\n`)

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

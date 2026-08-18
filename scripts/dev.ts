#!/usr/bin/env bun
/** Runs the orchestrator and the dashboard together, with prefixed output. */
import { spawn } from 'node:child_process'

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
  return child
})

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

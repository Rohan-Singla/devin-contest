#!/usr/bin/env bun
/**
 * API + WebSocket server.
 *
 * Hono handles HTTP; Bun's native WebSocket handles the live agent feed. They
 * share one `Bun.serve`, which is the reason for choosing Hono over Express.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ServerWebSocket, WebSocketHandler } from 'bun'
import { join } from 'node:path'
import {
  createIssue,
  createProject,
  getProject,
  listEvents,
  listIssues,
  listProjects,
} from './platform/db'
import { publish, subscribe } from './platform/bus'
import { log as gitLog } from './platform/git'
import { getPreview, runProject, runSingleIssue, shutdownPreviews } from './orchestrator/dispatcher'

const PORT = Number(process.env.PORT ?? 4000)
const app = new Hono()

app.use('/*', cors())

// ───────────────────────────────────────────────────────── projects

app.post('/api/projects', async (c) => {
  const { prompt } = await c.req.json<{ prompt?: string }>()
  if (!prompt?.trim()) return c.json({ error: 'prompt is required' }, 400)

  const slug = `p-${Date.now().toString(36)}`
  const project = createProject('Planning…', prompt.trim(), join('data/repos', slug))

  // Fire and forget: the build streams over the socket.
  runProject(project.id).catch((err) => {
    publish(project.id, null, 'log', { message: `build failed: ${err.message}` })
  })

  return c.json(project, 201)
})

app.get('/api/projects', (c) => c.json(listProjects()))

app.get('/api/projects/:id', (c) => {
  const project = getProject(c.req.param('id'))
  if (!project) return c.json({ error: 'not found' }, 404)
  return c.json({
    project,
    issues: listIssues(project.id),
    events: listEvents(project.id),
  })
})

app.get('/api/projects/:id/commits', async (c) => {
  const project = getProject(c.req.param('id'))
  if (!project) return c.json({ error: 'not found' }, 404)
  try {
    return c.json(await gitLog(project.repoPath))
  } catch {
    return c.json([])
  }
})

// ───────────────────────────────────────────────────────── issues

app.post('/api/projects/:id/issues', async (c) => {
  const project = getProject(c.req.param('id'))
  if (!project) return c.json({ error: 'not found' }, 404)

  const body = await c.req.json<{
    title?: string
    body?: string
    paths?: string[]
    run?: boolean
  }>()
  if (!body.title?.trim()) return c.json({ error: 'title is required' }, 400)

  const issue = createIssue(project.id, {
    title: body.title.trim(),
    body: body.body?.trim() ?? '',
    paths: body.paths ?? [],
    wave: 0,
  })
  publish(project.id, issue.id, 'issue_created', issue)

  if (body.run !== false) {
    runSingleIssue(project.id, issue.id).catch((err) => {
      publish(project.id, issue.id, 'log', { message: `issue failed: ${err.message}` })
    })
  }

  return c.json(issue, 201)
})

app.post('/api/projects/:id/issues/:issueId/run', async (c) => {
  const project = getProject(c.req.param('id'))
  if (!project) return c.json({ error: 'not found' }, 404)

  runSingleIssue(project.id, c.req.param('issueId')).catch((err) => {
    publish(project.id, c.req.param('issueId'), 'log', { message: `issue failed: ${err.message}` })
  })
  return c.json({ started: true })
})

app.get('/api/projects/:id/preview', (c) => {
  const preview = getPreview(c.req.param('id'))
  return c.json({ url: preview ? `https://${preview.url}` : null })
})

app.get('/api/health', (c) => c.json({ ok: true }))

// ───────────────────────────────────────────────────────── websocket

type SocketData = { projectId?: string }

const sockets = new Set<ServerWebSocket<SocketData>>()

subscribe((event) => {
  const message = JSON.stringify(event)
  for (const socket of sockets) {
    // A client subscribes to one project; skip everything else.
    if (socket.data.projectId && socket.data.projectId !== event.projectId) continue
    try {
      socket.send(message)
    } catch {
      /* dropped clients are cleaned up on close */
    }
  }
})

const websocket: WebSocketHandler<SocketData> = {
  open(ws) {
    sockets.add(ws)
  },
  close(ws) {
    sockets.delete(ws)
  },
  message() {
    /* clients are read-only */
  },
}

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      const projectId = url.searchParams.get('project') ?? undefined
      if (srv.upgrade(req, { data: { projectId } satisfies SocketData })) {
        return undefined as unknown as Response
      }
      return new Response('websocket upgrade failed', { status: 400 })
    }
    return app.fetch(req, srv)
  },
  websocket,
})

console.log(`\n  mini-devin server → http://localhost:${server.port}`)
console.log(`  websocket         → ws://localhost:${server.port}/ws?project=<id>\n`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    console.log('\nshutting down preview sandboxes…')
    await shutdownPreviews()
    process.exit(0)
  })
}

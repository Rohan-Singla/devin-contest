import type { BusEvent, Issue, Project } from './types'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error ?? res.statusText)
  }
  return res.json()
}

export const api = {
  listProjects: () => request<Project[]>('/api/projects'),

  createProject: (prompt: string) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ prompt }) }),

  getProject: (id: string) =>
    request<{ project: Project; issues: Issue[]; events: BusEvent[] }>(`/api/projects/${id}`),

  createIssue: (projectId: string, title: string, body: string) =>
    request<Issue>(`/api/projects/${projectId}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    }),

  runIssue: (projectId: string, issueId: string) =>
    request<{ started: boolean }>(`/api/projects/${projectId}/issues/${issueId}/run`, {
      method: 'POST',
    }),

  /** Kicks off a preview boot; the URL arrives later as a `preview_ready` event. */
  restartPreview: (projectId: string) =>
    request<{ starting: boolean }>(`/api/projects/${projectId}/preview/restart`, {
      method: 'POST',
    }),

  commits: (projectId: string) =>
    request<{ hash: string; message: string; date: string }[]>(`/api/projects/${projectId}/commits`),
}

/** Live event feed for one project. Reconnects automatically. */
export function connectFeed(projectId: string, onEvent: (event: BusEvent) => void): () => void {
  let socket: WebSocket | null = null
  let closed = false
  let retry: ReturnType<typeof setTimeout>

  const open = () => {
    if (closed) return
    const wsBase = BASE.replace(/^http/, 'ws')
    socket = new WebSocket(`${wsBase}/ws?project=${projectId}`)
    socket.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data))
      } catch {
        /* ignore malformed frames */
      }
    }
    socket.onclose = () => {
      if (!closed) retry = setTimeout(open, 1500)
    }
  }

  open()
  return () => {
    closed = true
    clearTimeout(retry)
    socket?.close()
  }
}

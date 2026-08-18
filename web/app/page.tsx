'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, connectFeed } from '@/lib/api'
import type { AgentPanel, BusEvent, Issue, Project } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { IssueBoard } from '@/components/IssueBoard'
import { AgentPanels } from '@/components/AgentPanels'
import { PreviewPane } from '@/components/PreviewPane'
import { NewIssueForm } from '@/components/NewIssueForm'
import { ActivityLog } from '@/components/ActivityLog'

const MAX_PANELS = 3

export default function Page() {
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [panels, setPanels] = useState<Record<number, AgentPanel>>({})
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Panels need issue titles, but must not re-subscribe whenever issues change.
  const issuesRef = useRef<Issue[]>([])
  issuesRef.current = issues

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setError('orchestrator is not reachable'))
  }, [])

  const load = useCallback(async (id: string) => {
    const data = await api.getProject(id)
    // A stored URL whose sandbox is gone would render a dead iframe.
    setProject({
      ...data.project,
      previewUrl: data.project.previewLive ? data.project.previewUrl : null,
    })
    setIssues(data.issues)
    setPanels({})
    setLogs(
      data.events
        .filter((e) => e.type === 'log')
        .slice(-60)
        .map((e) => e.payload?.message ?? '')
    )
  }, [])

  const onEvent = useCallback((event: BusEvent) => {
    const { type, payload, issueId } = event

    switch (type) {
      case 'log':
        setLogs((prev) => [...prev.slice(-150), payload?.message ?? ''])
        return

      case 'issue_created':
        setIssues((prev) => (prev.some((i) => i.id === payload.id) ? prev : [...prev, payload]))
        return

      case 'project_status':
        setProject((prev) => (prev ? { ...prev, status: payload.status } : prev))
        return

      case 'preview_ready':
        setProject((prev) => (prev ? { ...prev, previewUrl: payload.url } : prev))
        return

      case 'preview_failed':
        setError(`preview failed: ${payload?.error ?? 'unknown error'}`)
        return

      case 'issue_status': {
        if (!issueId) return
        setIssues((prev) =>
          prev.map((i) =>
            i.id === issueId
              ? {
                  ...i,
                  status: payload.status,
                  error: payload.error ?? null,
                  agentSlot: payload.agentSlot ?? i.agentSlot,
                }
              : i
          )
        )
        // Free the panel once the agent is no longer working.
        if (payload.status !== 'running') {
          setPanels((prev) => {
            const next: Record<number, AgentPanel> = {}
            for (const [slot, panel] of Object.entries(prev)) {
              if (panel.issueId !== issueId) next[Number(slot)] = panel
            }
            return next
          })
        }
        return
      }

      case 'agent_text':
      case 'agent_tool': {
        const slot: number = payload?.slot ?? 0
        setPanels((prev) => {
          const title = issuesRef.current.find((i) => i.id === issueId)?.title ?? 'working…'
          const panel: AgentPanel = prev[slot] ?? {
            slot,
            issueId,
            issueTitle: title,
            text: '',
            tools: [],
          }

          if (type === 'agent_text') {
            return {
              ...prev,
              [slot]: {
                ...panel,
                issueId,
                issueTitle: title,
                text: (panel.text + payload.text).slice(-3000),
              },
            }
          }

          const tools =
            payload.phase === 'start'
              ? [...panel.tools, { name: payload.name, args: payload.args, phase: 'start' }].slice(-16)
              : panel.tools.map((tool, index) =>
                  index === panel.tools.length - 1
                    ? { ...tool, ok: payload.ok, phase: 'end' }
                    : tool
                )

          return { ...prev, [slot]: { ...panel, issueId, issueTitle: title, tools } }
        })
        return
      }
    }
  }, [])

  useEffect(() => {
    if (!project) return
    return connectFeed(project.id, onEvent)
  }, [project?.id, onEvent])

  async function build() {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createProject(prompt)
      setProjects((prev) => [created, ...prev])
      setPrompt('')
      await load(created.id)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const activePanels = useMemo(
    () =>
      Object.values(panels)
        .sort((a, b) => a.slot - b.slot)
        .slice(0, MAX_PANELS),
    [panels]
  )

  const merged = issues.filter((i) => i.status === 'merged').length
  const active = issues.filter((i) => i.status === 'running' || i.status === 'merging').length

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b px-5 py-3">
        <div className="shrink-0 font-semibold tracking-tight">
          mini<span className="text-primary">devin</span>
        </div>

        <div className="flex flex-1 gap-2">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && build()}
            placeholder="Build an ecommerce website with a React frontend and a Node backend…"
            className="flex-1"
          />
          <Button onClick={build} disabled={busy || !prompt.trim()}>
            {busy ? 'Starting…' : 'Build'}
          </Button>
        </div>

        <Select value={project?.id ?? ''} onValueChange={(value) => value && load(value)}>
          <SelectTrigger className="w-52 shrink-0">
            <SelectValue placeholder="Open project…" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {error && <div className="bg-destructive/15 px-5 py-2 text-[12px] text-destructive">{error}</div>}

      {!project ? (
        <div className="flex flex-1 items-center justify-center px-6 text-muted-foreground">
          <div className="max-w-lg text-center">
            <div className="mb-2 text-lg text-foreground">Describe an application</div>
            <p className="leading-relaxed">
              A planner splits your prompt into issues that own disjoint files, then up to three
              agents work them in parallel — each in its own sandbox. Merges are serialised and
              verified against the test suite before they land.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[320px_1fr_minmax(360px,32%)] overflow-hidden">
          <aside className="flex flex-col overflow-hidden border-r">
            <div className="border-b px-4 py-3">
              <div className="truncate font-medium">{project.name}</div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="h-4 px-1.5 capitalize">
                  {project.status}
                </Badge>
                <span>{merged} merged</span>
                {active > 0 && <span className="text-warning">{active} active</span>}
              </div>
            </div>
            <IssueBoard issues={issues} />
            <NewIssueForm
              onCreate={async (title, body) => {
                await api.createIssue(project.id, title, body)
              }}
            />
          </aside>

          <main className="flex flex-col overflow-hidden">
            <AgentPanels panels={activePanels} />
            <ActivityLog logs={logs} />
          </main>

          <PreviewPane
            url={project.previewUrl}
            status={project.status}
            onRestart={async () => {
              setError(null)
              await api.restartPreview(project.id)
            }}
          />
        </div>
      )}
    </div>
  )
}

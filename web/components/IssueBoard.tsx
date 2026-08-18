'use client'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Issue, IssueStatus } from '@/lib/types'

const STATUS: Record<IssueStatus, { dot: string; label: string }> = {
  todo: { dot: 'bg-muted-foreground', label: 'queued' },
  running: { dot: 'bg-warning animate-pulse', label: 'working' },
  merging: { dot: 'bg-primary animate-pulse', label: 'merging' },
  merged: { dot: 'bg-success', label: 'merged' },
  failed: { dot: 'bg-destructive', label: 'failed' },
  blocked: { dot: 'bg-muted-foreground', label: 'blocked' },
}

export function IssueBoard({ issues }: { issues: Issue[] }) {
  const waves = [...new Set(issues.map((i) => i.wave))].sort((a, b) => a - b)

  if (!issues.length) {
    return (
      <div className="flex-1 px-4 py-6 text-muted-foreground">Planning the work…</div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 px-3 py-3">
        {waves.map((wave) => {
          const inWave = issues.filter((i) => i.wave === wave)
          const done = inWave.filter((i) => i.status === 'merged').length

          return (
            <section key={wave}>
              <header className="mb-2 flex items-center gap-2 px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Wave {wave + 1}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {done}/{inWave.length}
                </span>
                {inWave.length > 1 && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                    parallel
                  </Badge>
                )}
              </header>

              <div className="space-y-1.5">
                {inWave.map((issue) => {
                  const status = STATUS[issue.status]
                  return (
                    <Card key={issue.id} className="gap-0 rounded-md px-3 py-2" title={issue.body}>
                      <div className="flex items-start gap-2">
                        <span
                          className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', status.dot)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] leading-tight">
                            <span className="text-muted-foreground">#{issue.number}</span>{' '}
                            {issue.title}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{status.label}</span>
                            {issue.status === 'running' && issue.agentSlot !== null && (
                              <span className="text-warning">agent {issue.agentSlot + 1}</span>
                            )}
                          </div>
                          {issue.error && (
                            <p
                              className="mt-1 truncate text-[11px] text-destructive"
                              title={issue.error}
                            >
                              {issue.error}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </ScrollArea>
  )
}

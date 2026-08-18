'use client'

import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { AgentPanel } from '@/lib/types'

/** Show the argument that identifies what a tool call is actually doing. */
function summarise(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  return String(a.command ?? a.path ?? a.pattern ?? '').slice(0, 70)
}

function Panel({ panel }: { panel: AgentPanel }) {
  const tailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end' })
  }, [panel.text, panel.tools.length])

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
      <CardHeader className="flex-row items-center gap-2 space-y-0 border-b px-3 py-2 [.border-b]:pb-2">
        <span className="size-1.5 animate-pulse rounded-full bg-warning" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agent {panel.slot + 1}
        </span>
        <span className="truncate text-[12px]">{panel.issueTitle}</span>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full">
          <div className="space-y-1 px-3 py-2 font-mono text-[11px] leading-relaxed">
            {panel.tools.map((tool, index) => (
              <div key={index} className="flex gap-2">
                <span
                  className={cn(
                    tool.phase === 'end'
                      ? tool.ok
                        ? 'text-success'
                        : 'text-destructive'
                      : 'text-warning'
                  )}
                >
                  {tool.phase === 'end' ? (tool.ok ? '✓' : '✗') : '→'}
                </span>
                <span className="text-primary">{tool.name}</span>
                <span className="truncate text-muted-foreground">{summarise(tool.args)}</span>
              </div>
            ))}

            {panel.text && (
              <p className="whitespace-pre-wrap pt-1 font-sans text-[12px] text-muted-foreground">
                {panel.text.slice(-700)}
              </p>
            )}
            <div ref={tailRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

export function AgentPanels({ panels }: { panels: AgentPanel[] }) {
  if (!panels.length) {
    return (
      <div className="flex h-56 items-center justify-center border-b text-muted-foreground">
        No agents running — work appears here as issues are picked up.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 gap-2 border-b p-2">
      {panels.map((panel) => (
        <Panel key={panel.slot} panel={panel} />
      ))}
    </div>
  )
}

'use client'

import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'

export function ActivityLog({ logs }: { logs: string[] }) {
  const tailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  return (
    <div className="flex h-44 shrink-0 flex-col">
      <div className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Orchestrator
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 px-4 py-1 font-mono text-[11px] text-muted-foreground">
          {logs.length === 0 ? (
            <div>Waiting…</div>
          ) : (
            logs.map((line, index) => <div key={index}>{line}</div>)
          )}
          <div ref={tailRef} />
        </div>
      </ScrollArea>
    </div>
  )
}

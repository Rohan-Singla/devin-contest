'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ProjectStatus } from '@/lib/types'

export function PreviewPane({ url, status }: { url: string | null; status: ProjectStatus }) {
  // Bumping this remounts the iframe — how freshly merged work becomes visible.
  const [nonce, setNonce] = useState(0)

  return (
    <section className="flex flex-col overflow-hidden border-l">
      <header className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Live preview
        </span>
        {url && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => setNonce((n) => n + 1)}
            >
              Refresh
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto truncate text-[11px] text-primary hover:underline"
            >
              open ↗
            </a>
          </>
        )}
      </header>

      <div className="flex-1 bg-white">
        {url ? (
          <iframe
            key={nonce}
            src={url}
            className="size-full border-0"
            title="Application preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-background text-muted-foreground">
            {status === 'failed' ? 'Preview unavailable' : 'Booting the preview sandbox…'}
          </div>
        )}
      </div>
    </section>
  )
}

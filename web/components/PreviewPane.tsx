'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ProjectStatus } from '@/lib/types'

export function PreviewPane({
  url,
  status,
  onRestart,
}: {
  url: string | null
  status: ProjectStatus
  onRestart: () => Promise<void>
}) {
  // Bumping this remounts the iframe — how freshly merged work becomes visible.
  const [nonce, setNonce] = useState(0)
  const [restarting, setRestarting] = useState(false)

  // The boot is asynchronous: the request returns at once and the URL arrives
  // over the socket, so the spinner clears on the URL, not on the response.
  useEffect(() => {
    if (url) setRestarting(false)
  }, [url])

  async function restart() {
    setRestarting(true)
    try {
      await onRestart()
    } catch {
      setRestarting(false)
    }
  }

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
          <div className="flex size-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground">
            {status === 'planning' || status === 'building' ? (
              <p>Booting the preview sandbox…</p>
            ) : (
              <>
                <p className="max-w-xs leading-relaxed">
                  The preview sandbox has stopped. Sandboxes expire after an hour and shut down
                  with the orchestrator — the code is safe in the project repository.
                </p>
                <Button size="sm" onClick={restart} disabled={restarting}>
                  {restarting ? 'Starting sandbox…' : 'Restart preview'}
                </Button>
                {restarting && (
                  <p className="text-[11px]">
                    Booting a VM and installing dependencies — about 90 seconds.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

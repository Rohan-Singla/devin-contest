'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function NewIssueForm({
  onCreate,
}: {
  onCreate: (title: string, body: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await onCreate(title.trim(), body.trim())
      setTitle('')
      setBody('')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        className="justify-start rounded-none border-t py-6 text-[13px] text-muted-foreground"
      >
        + New issue
      </Button>
    )
  }

  return (
    <div className="space-y-2 border-t p-3">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a product reviews section"
        className="h-8 text-[13px]"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What should be built, and what does done look like?"
        rows={3}
        className="resize-none text-[13px]"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={busy || !title.trim()}>
          {busy ? 'Dispatching…' : 'Create & run'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

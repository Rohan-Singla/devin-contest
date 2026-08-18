/**
 * Event bus. Every orchestrator event is persisted, then fanned out to any
 * connected WebSocket client. Persist-then-broadcast means a client that joins
 * late can replay history and see the same picture.
 */
import { recordEvent } from './db'

export type Listener = (event: BusEvent) => void

export interface BusEvent {
  id: number
  projectId: string
  issueId: string | null
  ts: number
  type: string
  payload: unknown
}

const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** High-frequency events (token deltas) are broadcast but not persisted. */
const EPHEMERAL = new Set(['agent_text'])

export function publish(
  projectId: string,
  issueId: string | null,
  type: string,
  payload: unknown = null
): void {
  const event: BusEvent = EPHEMERAL.has(type)
    ? { id: -1, projectId, issueId, ts: Date.now(), type, payload }
    : recordEvent(projectId, issueId, type, payload)

  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* a broken client must never break the orchestrator */
    }
  }
}

import type { PtyDisposable } from '../terminal-pty-backend'

/** A listener set in node-pty's `IEvent` shape. */
export function ptyEvent<Event>() {
  const set = new Set<(event: Event) => void>()
  return {
    add: (listener: (event: Event) => void): PtyDisposable => {
      set.add(listener)
      return { dispose: () => set.delete(listener) }
    },
    emit: (event: Event) => {
      for (const listener of [...set]) listener(event)
    },
  }
}

/**
 * Decoded terminal output with pause and resume. Neither backend can stop its reader, so a
 * paused terminal keeps its output in memory until it resumes, where node-pty left it in the
 * kernel buffer and so also stopped a fast writer.
 */
export function ptyOutput() {
  const data = ptyEvent<string>()
  const decoder = new TextDecoder('utf-8')
  const pending: string[] = []
  let paused = false
  const deliver = (text: string) => {
    if (text.length === 0) return
    if (paused) pending.push(text)
    else data.emit(text)
  }
  return {
    onData: data.add,
    push: (bytes: Uint8Array) => deliver(decoder.decode(bytes, { stream: true })),
    /** Delivers what the decoder still holds of a split character. */
    flush: () => deliver(decoder.decode()),
    pause: () => {
      paused = true
    },
    resume: () => {
      paused = false
      for (const text of pending.splice(0)) data.emit(text)
    },
  }
}

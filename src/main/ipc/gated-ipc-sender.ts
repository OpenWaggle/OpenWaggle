/**
 * Which renderer document sent a request the backend gate holds (A-F2). The gate holds requests
 * for as long as startup takes, a failed start included; a document that reloaded meanwhile
 * (DevTools Cmd+R, a crash reload) or a window that closed no longer wants what it asked for, so a
 * request of theirs is dropped when the gate opens instead of running then.
 */
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

type GatedSender = Pick<IpcMainEvent['sender'], 'isDestroyed' | 'on'>

/** Counts the main-frame documents a sender has loaded since the gate first held one of its requests. */
const documentGenerations = new WeakMap<GatedSender, { value: number }>()

function documentGeneration(sender: GatedSender) {
  const known = documentGenerations.get(sender)
  if (known) return known
  const generation = { value: 0 }
  documentGenerations.set(sender, generation)
  const nextDocument = () => {
    generation.value += 1
  }
  // A reload or navigation commits a new document; a crashed renderer loses the old one.
  sender.on('did-navigate', nextDocument)
  sender.on('render-process-gone', nextDocument)
  return generation
}

/** Remembers the document sending `event`; the returned check says whether it is still there. */
export function rememberGatedSender(
  event: Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender'>,
): () => boolean {
  const { sender } = event
  const generation = documentGeneration(sender)
  const sentFrom = generation.value
  return () => !sender.isDestroyed() && generation.value === sentFrom
}

/** What a held request from a document that is gone settles with; nobody is there to read it. */
export class GatedSenderGoneError extends Error {
  constructor(channel: string) {
    super(`"${channel}" was sent by a window that closed or reloaded before startup finished.`)
    this.name = 'GatedSenderGoneError'
  }
}

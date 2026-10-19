/**
 * What the Host says when a Session already has a writer (a Run, a compaction, a branch switch,
 * or a copy), and how the GUI recognizes it. Both sides read this module, so the message the Host
 * throws and the one the GUI turns into "this Session is busy" cannot drift apart.
 */
/** What holds a Session's Pi file: a classic or Waggle Run, a compaction, or a tree mutation. */
export type SessionWriterKind = 'classic' | 'waggle' | 'compaction' | 'tree-mutation'

export function sessionWriterBusyMessage(sessionId: string, writerKind: SessionWriterKind) {
  return `Session ${sessionId} already has an active ${writerKind} Pi writer.`
}

const SESSION_WRITER_BUSY = /^Session \S+ already has an active \S+ Pi writer\.?$/

export function isSessionWriterBusyMessage(message: string) {
  return SESSION_WRITER_BUSY.test(message.trim())
}

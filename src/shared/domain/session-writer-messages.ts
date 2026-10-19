/**
 * What the Host says when a Session already has a writer (a Run, a compaction, a branch switch,
 * or a copy), and how the GUI recognizes it. Both sides read this module, so the message the Host
 * throws and the one the GUI turns into "this Session is busy" cannot drift apart.
 */
export function sessionWriterBusyMessage(sessionId: string, writerKind: string) {
  return `Session ${sessionId} already has an active ${writerKind} Pi writer.`
}

const SESSION_WRITER_BUSY = /^Session \S+ already has an active \S+ Pi writer\.?$/

export function isSessionWriterBusyMessage(message: string) {
  return SESSION_WRITER_BUSY.test(message.trim())
}

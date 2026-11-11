import type { Pointer } from 'bun:ffi'

/**
 * Drains a ConPTY output pipe on a Bun Worker thread (ADR 0064): an anonymous pipe has no
 * overlapped reads, so a blocking `ReadFile` loop runs off the main thread and posts each chunk
 * back. The pipe ends with `ERROR_BROKEN_PIPE` once the pseudoconsole closes.
 *
 * The Worker's source is inline (a Blob URL), so the main bundle has no second entry point.
 * A blocked read cannot be interrupted, so the reader only ever ends with its pipe.
 */
const READ_CHUNK_BYTES = 64 * 1024

const READER_SOURCE = `
import { dlopen, ptr } from 'bun:ffi'
const kernel32 = dlopen('kernel32.dll', {
  ReadFile: { args: ['ptr', 'ptr', 'u32', 'ptr', 'ptr'], returns: 'i32' },
})
self.onmessage = (event) => {
  const buffer = new Uint8Array(event.data.chunkBytes)
  const read = new Uint32Array(1)
  while (kernel32.symbols.ReadFile(event.data.handle, ptr(buffer), buffer.length, ptr(read), null) !== 0) {
    if (read[0] > 0) postMessage(buffer.slice(0, read[0]))
  }
  postMessage(null)
}
`

export interface ConptyReaderEvents {
  readonly data: (bytes: Uint8Array) => void
  readonly end: (error: Error | null) => void
}

export function startConptyReader(handle: Pointer, events: ConptyReaderEvents) {
  const url = URL.createObjectURL(new Blob([READER_SOURCE], { type: 'application/javascript' }))
  const worker = new Worker(url, { type: 'module' })
  let ended = false
  const end = (error: Error | null) => {
    if (ended) return
    ended = true
    worker.terminate()
    URL.revokeObjectURL(url)
    events.end(error)
  }
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data instanceof Uint8Array) events.data(event.data)
    else end(null)
  })
  worker.addEventListener('error', () => end(new Error('The terminal output reader failed.')))
  worker.postMessage({ handle, chunkBytes: READ_CHUNK_BYTES })
}

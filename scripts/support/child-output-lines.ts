import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

/** A child spawned with stdin ignored and stdout and stderr piped. */
export type PipedChildProcess = ChildProcessByStdio<null, Readable, Readable>

/** Calls `onLine` with each complete line the stream writes, without the newline. */
export function forwardLines(stream: Readable, onLine: (line: string) => void) {
  let buffered = ''
  stream.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      onLine(buffered.slice(0, newline))
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  })
}

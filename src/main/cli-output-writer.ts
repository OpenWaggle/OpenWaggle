import { writeSync } from 'node:fs'
import type { Writable } from 'node:stream'

const MIN_ROUTED_OUTPUT_FD = 3

/**
 * The inherited descriptor the Linux shim routes CLI output to (`OPENWAGGLE_CLI_OUTPUT_FD`), or
 * `null` for plain stdout. Kept free of `env.ts` so the boot shim can answer `--version` and
 * `--help` before the main bundle loads.
 */
export function parseCliOutputFd(raw: string | undefined) {
  if (raw === undefined) return null
  const fd = Number(raw)
  if (!Number.isSafeInteger(fd) || fd < MIN_ROUTED_OUTPUT_FD) {
    throw new Error('OPENWAGGLE_CLI_OUTPUT_FD must identify an inherited file descriptor.')
  }
  return fd
}

export function writeAllToFd(fd: number, value: string | Buffer) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  let offset = 0
  while (offset < bytes.byteLength) offset += writeSync(fd, bytes, offset)
}

/** Resolve only after a Writable has accepted and flushed a chunk. */
export function writeWritableChunk(output: Writable, value: string) {
  return new Promise<void>((resolve, reject) => {
    let writeReturned = false
    let callbackFinished = false
    let accepted = false
    let drained = false
    let settled = false

    const cleanup = () => {
      output.off('drain', onDrain)
      output.off('error', onError)
    }
    const finish = () => {
      if (settled || !writeReturned || !callbackFinished || (!accepted && !drained)) return
      settled = true
      cleanup()
      resolve()
    }
    const onDrain = () => {
      drained = true
      finish()
    }
    const onError = (error: Error) => {
      if (settled) {
        cleanup()
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const onCallbackError = (error: Error) => {
      if (settled) return
      settled = true
      output.off('drain', onDrain)
      reject(error)
    }

    output.once('error', onError)
    try {
      accepted = output.write(value, 'utf8', (error) => {
        if (error) {
          onCallbackError(error)
          return
        }
        callbackFinished = true
        finish()
      })
      writeReturned = true
      if (!accepted) output.once('drain', onDrain)
      finish()
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error))
      settled = true
      cleanup()
      reject(cause)
    }
  })
}

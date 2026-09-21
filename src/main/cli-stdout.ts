import { writeSync } from 'node:fs'
import { Writable } from 'node:stream'
import { env } from './env'

const MIN_ROUTED_OUTPUT_FD = 3

function routedOutputFd() {
  const raw = env.OPENWAGGLE_CLI_OUTPUT_FD
  if (raw === undefined) return null
  const fd = Number(raw)
  if (!Number.isSafeInteger(fd) || fd < MIN_ROUTED_OUTPUT_FD) {
    throw new Error('OPENWAGGLE_CLI_OUTPUT_FD must identify an inherited file descriptor.')
  }
  return fd
}

function writeAll(fd: number, value: string | Buffer) {
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

/** Keep application CLI bytes separate from Linux Electron startup stdout. */
export function writeCliStdout(value: string) {
  const fd = routedOutputFd()
  if (fd === null) return writeWritableChunk(process.stdout, value)
  writeAll(fd, value)
  return Promise.resolve()
}

/** A protocol-safe Writable for MCP stdio when the Linux shim isolates Electron stdout. */
export function routedCliStdoutStream() {
  const fd = routedOutputFd()
  if (fd === null) return null
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      try {
        writeAll(fd, chunk)
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    },
  })
}

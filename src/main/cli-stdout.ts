import { Writable } from 'node:stream'
import { isatty } from 'node:tty'
import { parseCliOutputFd, writeAllToFd, writeWritableChunk } from './cli-output-writer'
import { env } from './env'

export { writeWritableChunk } from './cli-output-writer'

function routedOutputFd() {
  return parseCliOutputFd(env.OPENWAGGLE_CLI_OUTPUT_FD)
}

/** Whether application CLI output reaches a terminal, including through the Linux shim's fd. */
export function cliStdoutIsTerminal() {
  const fd = routedOutputFd()
  return fd === null ? Boolean(process.stdout.isTTY) : isatty(fd)
}

/** Keep application CLI bytes separate from Linux Electron startup stdout. */
export function writeCliStdout(value: string) {
  const fd = routedOutputFd()
  if (fd === null) return writeWritableChunk(process.stdout, value)
  writeAllToFd(fd, value)
  return Promise.resolve()
}

/** A protocol-safe Writable for MCP stdio when the Linux shim isolates Electron stdout. */
export function routedCliStdoutStream() {
  const fd = routedOutputFd()
  if (fd === null) return null
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      try {
        writeAllToFd(fd, chunk)
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    },
  })
}

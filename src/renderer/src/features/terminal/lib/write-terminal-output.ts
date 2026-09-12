import type { Terminal } from '@xterm/xterm'

const PARSER_CHUNK_CODE_UNITS = 4_096
const MAX_SINGLE_UTF16_CODE_POINT = 0xffff

/** Queue RIS after old writes so a synchronous reset cannot be undone by them. */
export function resetTerminalOutput(terminal: Pick<Terminal, 'write'>) {
  terminal.write('\x1bc')
}

/** xterm checks its time budget between writes, never inside one large write. */
export function writeTerminalOutput(
  terminal: Pick<Terminal, 'write'>,
  data: string,
  callback?: () => void,
) {
  let offset = 0
  while (offset < data.length) {
    let end = Math.min(offset + PARSER_CHUNK_CODE_UNITS, data.length)
    if ((data.codePointAt(end - 1) ?? 0) > MAX_SINGLE_UTF16_CODE_POINT) end -= 1
    const chunk = data.slice(offset, end)
    // Queue all slices in order. xterm owns yielding and parser continuation;
    // only the last parsed slice may release the original event's ACK.
    if (end === data.length && callback !== undefined) terminal.write(chunk, callback)
    else terminal.write(chunk)
    offset = end
  }
}

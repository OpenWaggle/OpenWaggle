const ANSI_ESCAPE = '\u001B'
const ANSI_SGR_INTRODUCER = `${ANSI_ESCAPE}[`
const EMPTY_ARRAY_PAYLOAD = '[]'
const EMPTY_OBJECT_PAYLOAD = '{}'
const WHITESPACE = /\s/u

function formattingEnd(stdout: string, start: number) {
  let cursor = start

  while (cursor < stdout.length) {
    if (WHITESPACE.test(stdout[cursor] ?? '')) {
      cursor += 1
      continue
    }

    if (!stdout.startsWith(ANSI_SGR_INTRODUCER, cursor)) break

    let sgrCursor = cursor + ANSI_SGR_INTRODUCER.length
    while (sgrCursor < stdout.length) {
      const character = stdout[sgrCursor]
      if (character === 'm') {
        cursor = sgrCursor + 1
        break
      }
      if (character !== ';' && (character === undefined || character < '0' || character > '9')) {
        return cursor
      }
      sgrCursor += 1
    }

    if (sgrCursor >= stdout.length) break
  }

  return cursor
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function applicationCliStdout(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'linux') return stdout

  let cursor = formattingEnd(stdout, 0)
  let foundEmptyPayload = false

  while (
    stdout.startsWith(EMPTY_ARRAY_PAYLOAD, cursor) ||
    stdout.startsWith(EMPTY_OBJECT_PAYLOAD, cursor)
  ) {
    foundEmptyPayload = true
    cursor = formattingEnd(stdout, cursor + EMPTY_ARRAY_PAYLOAD.length)
  }

  if (!foundEmptyPayload || stdout[cursor] !== '{') return stdout

  const applicationResponse = stdout.slice(cursor)
  try {
    return isJsonObject(JSON.parse(applicationResponse)) ? applicationResponse : stdout
  } catch {
    return stdout
  }
}

const ANSI_ESCAPE = '\u001B'
const ANSI_CSI_INTRODUCER = `${ANSI_ESCAPE}[`
const ANSI_PARAMETER_MIN = 0x20
const ANSI_PARAMETER_MAX = 0x3f
const ANSI_FINAL_MIN = 0x40
const ANSI_FINAL_MAX = 0x7e
const EMPTY_ARRAY_PAYLOAD = '[]'
const EMPTY_OBJECT_PAYLOAD = '{}'
const DIAGNOSTIC_PREFIX_LENGTH = 256
const WHITESPACE = /\s/u

function ansiSequenceEnd(stdout: string, start: number) {
  if (!stdout.startsWith(ANSI_CSI_INTRODUCER, start)) return null

  let cursor = start + ANSI_CSI_INTRODUCER.length
  while (cursor < stdout.length) {
    const codePoint = stdout.charCodeAt(cursor)
    if (codePoint >= ANSI_FINAL_MIN && codePoint <= ANSI_FINAL_MAX) return cursor + 1
    if (codePoint < ANSI_PARAMETER_MIN || codePoint > ANSI_PARAMETER_MAX) return null
    cursor += 1
  }
  return null
}

function formattingEnd(stdout: string, start: number) {
  let cursor = start

  while (cursor < stdout.length) {
    if (WHITESPACE.test(stdout[cursor] ?? '')) {
      cursor += 1
      continue
    }

    const ansiEnd = ansiSequenceEnd(stdout, cursor)
    if (ansiEnd === null) break
    cursor = ansiEnd
  }

  return cursor
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonObjectEnd(stdout: string, start: number) {
  let depth = 0
  let escaped = false
  let inString = false

  for (let cursor = start; cursor < stdout.length; cursor += 1) {
    const character = stdout[cursor]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '"') inString = false
      continue
    }

    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') {
      depth += 1
      continue
    }
    if (character !== '}' && character !== ']') continue
    depth -= 1
    if (depth === 0) return cursor + 1
    if (depth < 0) return null
  }
  return null
}

function emptyPayloadEnd(stdout: string, start: number) {
  if (stdout.startsWith(EMPTY_ARRAY_PAYLOAD, start)) return start + EMPTY_ARRAY_PAYLOAD.length
  if (stdout.startsWith(EMPTY_OBJECT_PAYLOAD, start)) return start + EMPTY_OBJECT_PAYLOAD.length
  return null
}

function invalidStdout(stdout: string) {
  const prefix = stdout.slice(0, DIAGNOSTIC_PREFIX_LENGTH)
  const suffix = stdout.length > prefix.length ? '…' : ''
  return new Error(
    `OpenWaggle CLI stdout did not contain exactly one JSON object: ${JSON.stringify(prefix)}${suffix}`,
  )
}

export function applicationCliStdout(
  stdout: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'linux') return stdout

  let cursor = formattingEnd(stdout, 0)

  for (let payloadEnd = emptyPayloadEnd(stdout, cursor); payloadEnd !== null; ) {
    cursor = formattingEnd(stdout, payloadEnd)
    payloadEnd = emptyPayloadEnd(stdout, cursor)
  }

  if (stdout[cursor] !== '{') throw invalidStdout(stdout)

  const responseEnd = jsonObjectEnd(stdout, cursor)
  if (responseEnd === null) throw invalidStdout(stdout)

  const applicationResponse = stdout.slice(cursor, responseEnd)
  try {
    if (!isJsonObject(JSON.parse(applicationResponse))) throw invalidStdout(stdout)
  } catch {
    throw invalidStdout(stdout)
  }

  let whitespaceEnd = responseEnd
  while (WHITESPACE.test(stdout[whitespaceEnd] ?? '')) whitespaceEnd += 1

  let trailingCursor = formattingEnd(stdout, responseEnd)
  for (let payloadEnd = emptyPayloadEnd(stdout, trailingCursor); payloadEnd !== null; ) {
    trailingCursor = formattingEnd(stdout, payloadEnd)
    payloadEnd = emptyPayloadEnd(stdout, trailingCursor)
  }
  if (trailingCursor !== stdout.length) throw invalidStdout(stdout)
  return `${applicationResponse}${stdout.slice(responseEnd, whitespaceEnd)}`
}

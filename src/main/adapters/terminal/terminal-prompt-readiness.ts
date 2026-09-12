const ESC = '\x1b'
const BEL = '\x07'
const OSC_INTRODUCER = ']'
const STRING_TERMINATOR = '\\'
const MAX_OSC_PAYLOAD_LENGTH = 512

type ParserState = 'ground' | 'escape' | 'osc' | 'osc-escape' | 'rejected-osc'

export interface TerminalPromptReadinessDetector {
  /** Feed one raw PTY output chunk and count every authenticated prompt marker. */
  readonly feed: (chunk: string) => number
}

/**
 * Streaming detector for shell-integration prompt-end markers. It observes raw
 * PTY output without consuming it, accepts only OSC 133;B / OSC 633;B, and can
 * bind the marker to a spawn nonce so output replayed from an older generation
 * cannot release input queued for a new shell.
 */
export function createTerminalPromptReadinessDetector(
  expectedNonce?: string,
): TerminalPromptReadinessDetector {
  const acceptedPayloads = new Set(
    expectedNonce === undefined
      ? ['133;B', '633;B']
      : [`133;B;${expectedNonce}`, `633;B;${expectedNonce}`],
  )
  let state: ParserState = 'ground'
  let payload = ''

  const finishOsc = () => {
    const matched = acceptedPayloads.has(payload)
    payload = ''
    state = 'ground'
    return matched ? 1 : 0
  }

  const readEscape = (character: string) => {
    if (character === OSC_INTRODUCER) {
      payload = ''
      state = 'osc'
      return
    }
    state = character === ESC ? 'escape' : 'ground'
  }

  const readRejectedOsc = (character: string) => {
    if (character === BEL) {
      state = 'ground'
      return
    }
    if (character === ESC) state = 'osc-escape'
  }

  const readOscEscape = (character: string) => {
    if (character === STRING_TERMINATOR) {
      if (payload.length > MAX_OSC_PAYLOAD_LENGTH) {
        payload = ''
        state = 'ground'
        return 0
      }
      return finishOsc()
    }
    if (payload.length <= MAX_OSC_PAYLOAD_LENGTH) payload += ESC
    if (payload.length <= MAX_OSC_PAYLOAD_LENGTH) payload += character
    state = payload.length > MAX_OSC_PAYLOAD_LENGTH ? 'rejected-osc' : 'osc'
    return 0
  }

  const readOsc = (character: string) => {
    if (character === BEL) return finishOsc()
    if (character === ESC) {
      state = 'osc-escape'
      return 0
    }
    if (payload.length < MAX_OSC_PAYLOAD_LENGTH) {
      payload += character
      return 0
    }
    payload = ''
    state = 'rejected-osc'
    return 0
  }

  const readCharacter = (character: string) => {
    if (state === 'ground') {
      if (character === ESC) state = 'escape'
      return 0
    }
    if (state === 'escape') {
      readEscape(character)
      return 0
    }
    if (state === 'rejected-osc') {
      readRejectedOsc(character)
      return 0
    }
    if (state === 'osc-escape') return readOscEscape(character)
    return readOsc(character)
  }

  const feed = (chunk: string) => {
    let matches = 0
    for (const character of chunk) {
      matches += readCharacter(character)
    }
    return matches
  }

  return { feed }
}

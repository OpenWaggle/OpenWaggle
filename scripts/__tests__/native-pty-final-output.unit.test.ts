import { describe, expect, it } from 'vitest'
import { assertFinalPayload } from '../native-pty-probe-support'

const PREFIX = 'OPENWAGGLE_PTY_FINAL_START:'
const SUFFIX = ':OPENWAGGLE_PTY_FINAL_END'
const PAYLOAD = '~'.repeat(256 * 1024)

function conptyOutput(payload: string) {
  return `\x1b[?25l${PREFIX}${payload.match(/.{1,80}/gu)?.join('\r\n\x1b[24;1H')}${SUFFIX}\x1b[?25h`
}

describe('native final output integrity', () => {
  it('accepts an exact Unix byte payload', () => {
    expect(() => assertFinalPayload('Unix PTY', `${PREFIX}${PAYLOAD}${SUFFIX}`, 'linux')).not.toThrow()
  })

  it('accepts the exact Windows payload interleaved with console presentation controls', () => {
    expect(() => assertFinalPayload('ConPTY', conptyOutput(PAYLOAD), 'win32')).not.toThrow()
  })

  it.each([PAYLOAD.slice(1), `${PAYLOAD}~`, `!${PAYLOAD.slice(1)}`])(
    'rejects dropped, duplicated, or changed Windows payload characters', (payload) => {
      expect(() => assertFinalPayload('ConPTY', conptyOutput(payload), 'win32')).toThrow('corrupted')
    },
  )

  it('does not normalize arbitrary changes to Unix output', () => {
    expect(() => assertFinalPayload('Unix PTY', conptyOutput(PAYLOAD), 'linux')).toThrow('corrupted')
  })
})

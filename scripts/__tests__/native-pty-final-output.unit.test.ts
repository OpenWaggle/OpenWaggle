import { describe, expect, it } from 'vitest'
import { assertFinalPayload } from '../native-pty-probe-support'

const PREFIX = 'OPENWAGGLE_PTY_FINAL_START:'
const SUFFIX = ':OPENWAGGLE_PTY_FINAL_END'
const PAYLOAD = '~'.repeat(256 * 1024)

function conptyOutput(payload: string) {
  const text = `${PREFIX}${payload}${SUFFIX}`
  const title = '\x1b]0;C:\\hostedtoolcache\\windows\\node\\node.exe\x07'
  // Redraw the last cell before wrapping, without adding another visible cell.
  const rows = text.match(/.{1,80}/gu)?.map((row, index) =>
    `${row}\x1b[${row.length}G${row.at(-1)}${index === 0 ? title : ''}`,
  ).join('')
  return `\x1b[?25l${rows}\x1b[?25h`
}

describe('native final output integrity', () => {
  it('reports bounded raw and rendered evidence when a Windows marker is missing', async () => {
    const output = `\x1b[?25l${PAYLOAD}${SUFFIX}`
    await expect(assertFinalPayload('WinPTY', output, 'win32')).rejects.toThrow(
      `WinPTY dropped final output markers (start -1, end ${PAYLOAD.length}; ${output.length} raw characters; ${PAYLOAD.length + SUFFIX.length} visible characters;`,
    )
    try {
      await assertFinalPayload('WinPTY', output, 'win32')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) throw error
      expect(error.message.length).toBeLessThan(1_000)
      expect(error.message).toContain('raw head "\\u001b[?25l')
      expect(error.message).toContain(`${SUFFIX}"`)
    }
  })

  it('accepts an exact Unix byte payload', async () => {
    await expect(assertFinalPayload('Unix PTY', `${PREFIX}${PAYLOAD}${SUFFIX}`, 'linux')).resolves.toBeUndefined()
  })

  it('accepts Windows cursor redraws and title changes without counting them as payload', async () => {
    await expect(assertFinalPayload('ConPTY', conptyOutput(PAYLOAD), 'win32')).resolves.toBeUndefined()
  })

  it.each([PAYLOAD.slice(1), `${PAYLOAD}~`, `!${PAYLOAD.slice(1)}`])(
    'rejects dropped, duplicated, or changed Windows payload characters', async (payload) => {
      await expect(assertFinalPayload('ConPTY', conptyOutput(payload), 'win32')).rejects.toThrow('corrupted')
    },
  )

  it('does not normalize arbitrary changes to Unix output', async () => {
    await expect(assertFinalPayload('Unix PTY', conptyOutput(PAYLOAD), 'linux')).rejects.toThrow('corrupted')
  })
})

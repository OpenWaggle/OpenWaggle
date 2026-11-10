import { describe, expect, it } from 'vitest'
import { makeBrowserPreviewAutomationKeySequence } from '../browser-preview-automation-keyboard'

describe('browser preview automation keyboard packets', () => {
  it('builds native Enter down/up packets', () => {
    expect(makeBrowserPreviewAutomationKeySequence({ key: 'Enter' }, { isMac: false })).toEqual({
      keyDown: expect.objectContaining({
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        windowsVirtualKeyCode: 13,
      }),
      keyUp: expect.objectContaining({ type: 'keyUp', key: 'Enter', code: 'Enter' }),
    })
  })

  it('suppresses text and supplies macOS editing commands for Meta chords', () => {
    const sequence = makeBrowserPreviewAutomationKeySequence(
      { key: 'a', modifiers: ['Meta'] },
      { isMac: true },
    )

    expect(sequence.keyDown).toMatchObject({
      type: 'rawKeyDown',
      code: 'KeyA',
      modifiers: 4,
      commands: ['selectAll'],
    })
    expect(sequence.keyDown).not.toHaveProperty('text')
  })

  it('maps shifted punctuation to its physical key code', () => {
    expect(
      makeBrowserPreviewAutomationKeySequence({ key: '?', modifiers: ['Shift'] }, { isMac: false })
        .keyDown,
    ).toMatchObject({ code: 'Slash', key: '?', modifiers: 8, text: '?' })
  })
})

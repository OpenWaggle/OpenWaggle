import { fromPartial } from '@total-typescript/shoehorn'
import type { Input, MouseInputEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { BrowserPreviewAutomationInputArbitrator } from '../browser-preview-automation-input-arbitration'

function keyInput(overrides: Partial<Input> = {}) {
  return fromPartial<Input>({
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    location: 0,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...overrides,
  })
}

function mouseInput(overrides: Partial<MouseInputEvent> = {}) {
  return fromPartial<MouseInputEvent>({
    type: 'mouseDown',
    button: 'left',
    x: 12,
    y: 18,
    modifiers: [],
    ...overrides,
  })
}

describe('browser preview automation input arbitration', () => {
  it('consumes a delayed exact synthetic key signal after dispatch returned', () => {
    const arbitration = new BrowserPreviewAutomationInputArbitrator()
    arbitration.expect(
      'Input.dispatchKeyEvent',
      { type: 'rawKeyDown', key: 'Enter', code: 'Enter', location: 0, modifiers: 0 },
      1_000,
    )

    expect(arbitration.consumeKeyboard(keyInput(), 1_900)).toBe(true)
    expect(arbitration.consumeKeyboard(keyInput(), 1_901)).toBe(false)
  })

  it('does not let an interleaved human pointer event consume an expected agent event', () => {
    const arbitration = new BrowserPreviewAutomationInputArbitrator()
    arbitration.expect(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 12.5, y: 18.5, button: 'left' },
      1_000,
    )

    expect(arbitration.consumeMouse(mouseInput({ x: 30 }), 1_050)).toBe(false)
    expect(arbitration.consumeMouse(mouseInput(), 1_060)).toBe(true)
  })

  it('expires expected signals and supports cancellation after failed dispatch', () => {
    const arbitration = new BrowserPreviewAutomationInputArbitrator()
    const expired = arbitration.expect(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 12, y: 18, button: 'left' },
      1_000,
    )
    expect(arbitration.consumeMouse(mouseInput(), 2_001)).toBe(false)

    const cancelled = arbitration.expect(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: 12, y: 18, button: 'left' },
      2_000,
    )
    arbitration.cancel(cancelled ?? expired)
    expect(arbitration.consumeMouse(mouseInput(), 2_001)).toBe(false)
  })
})

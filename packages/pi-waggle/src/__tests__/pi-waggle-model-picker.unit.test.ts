import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import { visibleWidth } from '@mariozechner/pi-tui'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createModelPickerComponent, selectConcreteModelReference } from '../default-model-picker'

const items = [
  { provider: 'anthropic', id: 'alpha', name: 'Alpha Model', reference: 'anthropic/alpha' },
  { provider: 'openai', id: 'omega', name: 'Omega Model', reference: 'openai/omega' },
]

function createComponent() {
  const done = vi.fn()
  const requestRender = vi.fn()
  const component = createModelPickerComponent({
    items,
    currentModelReference: null,
    done,
    requestRender,
  })

  return { component, done, requestRender }
}

describe('createModelPickerComponent', () => {
  it('handles Kitty keyboard protocol navigation and selection keys', () => {
    const { component, done, requestRender } = createComponent()

    component.handleInput('\u001b[1;1B')
    component.handleInput('\u001b[13u')

    expect(requestRender).toHaveBeenCalledOnce()
    expect(done).toHaveBeenCalledWith('openai/omega')
  })

  it('filters using Kitty-encoded printable input', () => {
    const { component, done, requestRender } = createComponent()

    component.handleInput('\u001b[103u')
    component.handleInput('\u001b[13u')

    expect(requestRender).toHaveBeenCalledOnce()
    expect(done).toHaveBeenCalledWith('openai/omega')
  })

  it('reserves stable blank slots for the full result window', () => {
    const { component } = createComponent()

    const rendered = component.render(120)
    const resultRows = rendered.slice(3, 13)

    expect(resultRows).toHaveLength(10)
    expect(resultRows.slice(0, 2).map((line) => line.trim())).toEqual([
      '→ alpha [anthropic]',
      'omega [openai]',
    ])
    expect(resultRows.slice(2)).toEqual(Array.from({ length: 8 }, () => ''))
  })

  it('keeps a full visible window when navigating to the end', () => {
    const done = vi.fn()
    const requestRender = vi.fn()
    const manyItems = Array.from({ length: 15 }, (_, index) => ({
      provider: 'provider',
      id: `model-${String(index).padStart(2, '0')}`,
      name: `Model ${String(index)}`,
      reference: `provider/model-${String(index).padStart(2, '0')}`,
    }))
    const component = createModelPickerComponent({
      items: manyItems,
      currentModelReference: null,
      done,
      requestRender,
    })

    for (let index = 0; index < 14; index += 1) component.handleInput('\u001b[1;1B')

    const renderedModels = component
      .render(120)
      .filter((line) => line.includes('[provider]'))
      .map((line) => line.trim())

    expect(renderedModels).toHaveLength(10)
    expect(renderedModels[0]).toBe('model-05 [provider]')
    expect(renderedModels.at(-1)).toBe('→ model-14 [provider]')
  })

  it('normalizes multiline model details into terminal-safe single lines', () => {
    const done = vi.fn()
    const requestRender = vi.fn()
    const component = createModelPickerComponent({
      items: [
        {
          provider: 'provider',
          id: 'model',
          name: 'First line\nSecond line',
          reference: 'provider/model',
        },
      ],
      currentModelReference: null,
      done,
      requestRender,
    })

    const rendered = component.render(120)

    expect(rendered.every((line) => !line.includes('\n') && !line.includes('\r'))).toBe(true)
    expect(rendered).toContain('Model name: First line Second line')
  })

  it('truncates rendered lines by terminal-visible width', () => {
    const done = vi.fn()
    const requestRender = vi.fn()
    const component = createModelPickerComponent({
      items: [
        {
          provider: 'プロバイダー'.repeat(10),
          id: 'モデル'.repeat(10),
          name: '名前'.repeat(20),
          reference: 'wide/model',
        },
      ],
      currentModelReference: null,
      done,
      requestRender,
    })

    const renderedLines = component.render(20)

    expect(renderedLines.every((line) => visibleWidth(line) <= 20)).toBe(true)
  })

  it('renders the picker as an overlay to avoid scrollback corruption', async () => {
    const custom = vi.fn(async () => undefined)
    const ctx = fromPartial<ExtensionCommandContext>({
      hasUI: true,
      modelRegistry: { getAvailable: () => items },
      ui: { custom },
    })

    await selectConcreteModelReference({ ctx, currentModelReference: null })

    expect(custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        overlay: true,
        overlayOptions: expect.objectContaining({ anchor: 'top-left', row: 0, col: 0 }),
      }),
    )
  })

  it('cancels on Ctrl+C key encodings', () => {
    const ctrlCComponent = createComponent()
    const kittyCtrlCComponent = createComponent()

    ctrlCComponent.component.handleInput('\u0003')
    kittyCtrlCComponent.component.handleInput('\u001b[99;5u')

    expect(ctrlCComponent.done).toHaveBeenCalledWith(undefined)
    expect(kittyCtrlCComponent.done).toHaveBeenCalledWith(undefined)
  })
})

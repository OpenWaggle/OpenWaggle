import { visibleWidth } from '@mariozechner/pi-tui'
import { describe, expect, it, vi } from 'vitest'
import { createWaggleControlCenterComponent } from '../default-control-center-view'

function testPreset(id: string) {
  return {
    id,
    name: id,
    description: id,
    config: {
      mode: 'sequential',
      agents: [
        { label: 'A', model: 'provider/model', roleDescription: 'A', color: 'blue' },
        { label: 'B', model: 'provider/model', roleDescription: 'B', color: 'amber' },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 2 },
    },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
  } as const
}

function createComponent() {
  const done = vi.fn()
  const requestRender = vi.fn()
  const component = createWaggleControlCenterComponent({
    title: 'Waggle control center',
    rows: [
      {
        label: 'First preset',
        details: ['First details'],
        primaryAction: {
          type: 'activate-preset',
          preset: testPreset('first'),
        },
        secondaryAction: { type: 'create-preset' },
      },
      {
        label: 'Disable',
        details: ['Disable details'],
        primaryAction: { type: 'disable' },
      },
    ],
    done,
    requestRender,
  })

  return { component, done, requestRender }
}

describe('createWaggleControlCenterComponent', () => {
  it('handles Kitty keyboard protocol navigation and selection keys', () => {
    const { component, done, requestRender } = createComponent()

    component.handleInput('\u001b[1;1B')
    component.handleInput('\u001b[13u')

    expect(requestRender).toHaveBeenCalledOnce()
    expect(done).toHaveBeenCalledWith({ type: 'disable' })
  })

  it('handles Kitty-encoded space for secondary actions', () => {
    const { component, done } = createComponent()

    component.handleInput('\u001b[32u')

    expect(done).toHaveBeenCalledWith({ type: 'create-preset' })
  })

  it('reserves stable blank slots for the full row and details windows', () => {
    const { component } = createComponent()

    const rendered = component.render(120)
    const detailsIndex = rendered.findIndex((line) => line.includes('Waggle details'))
    const rowSlots = rendered.slice(3, detailsIndex - 1)

    expect(rowSlots).toHaveLength(12)
    expect(rowSlots.slice(0, 2).map((line) => line.trim())).toEqual(['→ First preset', 'Disable'])
    expect(rowSlots.slice(2)).toEqual(Array.from({ length: 10 }, () => ''))
    expect(rendered.slice(detailsIndex + 1)).toHaveLength(6)
  })

  it('normalizes multiline details into terminal-safe single lines', () => {
    const done = vi.fn()
    const requestRender = vi.fn()
    const component = createWaggleControlCenterComponent({
      title: 'Waggle control center',
      rows: [
        {
          label: 'Multiline preset',
          details: ['First line\nSecond line\r\nThird line'],
          primaryAction: { type: 'activate-preset', preset: testPreset('multiline') },
        },
      ],
      done,
      requestRender,
    })

    const rendered = component.render(120)

    expect(rendered.every((line) => !line.includes('\n') && !line.includes('\r'))).toBe(true)
    expect(rendered).toContain('First line Second line Third line')
  })

  it('keeps a full visible window when navigating to the end', () => {
    const done = vi.fn()
    const requestRender = vi.fn()
    const rows = Array.from({ length: 20 }, (_, index) => ({
      label: `Preset ${String(index)}`,
      details: [`Details ${String(index)}`],
      primaryAction: { type: 'activate-preset' as const, preset: testPreset(String(index)) },
    }))
    const component = createWaggleControlCenterComponent({
      title: 'Waggle control center',
      rows,
      done,
      requestRender,
    })

    for (let index = 0; index < 19; index += 1) component.handleInput('\u001b[1;1B')

    const renderedRows = component
      .render(120)
      .filter((line) => line.includes('Preset'))
      .map((line) => line.trim())

    expect(renderedRows).toHaveLength(12)
    expect(renderedRows[0]).toBe('Preset 8')
    expect(renderedRows.at(-1)).toBe('→ Preset 19')
  })

  it('truncates rendered lines by terminal-visible width', () => {
    const done = vi.fn()
    const requestRender = vi.fn()
    const component = createWaggleControlCenterComponent({
      title: 'Ｗ'.repeat(40),
      rows: [
        {
          label: 'プリセット'.repeat(20),
          details: ['説明'.repeat(20)],
          primaryAction: { type: 'activate-preset', preset: testPreset('wide') },
        },
      ],
      done,
      requestRender,
    })

    const renderedLines = component.render(20)

    expect(renderedLines.every((line) => visibleWidth(line) <= 20)).toBe(true)
  })

  it('cancels on Escape or Ctrl+C key encodings', () => {
    const escapeComponent = createComponent()
    const ctrlCComponent = createComponent()
    const kittyCtrlCComponent = createComponent()

    escapeComponent.component.handleInput('\u001b[27u')
    ctrlCComponent.component.handleInput('\u0003')
    kittyCtrlCComponent.component.handleInput('\u001b[99;5u')

    expect(escapeComponent.done).toHaveBeenCalledWith(undefined)
    expect(ctrlCComponent.done).toHaveBeenCalledWith(undefined)
    expect(kittyCtrlCComponent.done).toHaveBeenCalledWith(undefined)
  })
})

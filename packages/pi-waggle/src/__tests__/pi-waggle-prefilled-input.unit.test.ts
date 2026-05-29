import type { ExtensionCommandContext, Theme, ThemeColor } from '@mariozechner/pi-coding-agent'
import type { Component, Keybinding, KeybindingsManager, TUI } from '@mariozechner/pi-tui'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { promptPrefilledText } from '../default-prefilled-input'

type CustomFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: T) => void,
) => Component | Promise<Component>

function stripAnsi(value: string) {
  const escapeCharacter = String.fromCharCode(27)
  return value.replace(new RegExp(`${escapeCharacter}\\[[0-9;]*m`, 'g'), '')
}

describe('promptPrefilledText', () => {
  it('prefills the editable input with the existing value', async () => {
    const renderedLines: string[] = []
    const custom = vi.fn(async <T>(factory: CustomFactory<T>) => {
      let result: T | undefined
      const component = await factory(
        fromPartial<TUI>({}),
        fromPartial<Theme>({ fg: (_color: ThemeColor, text: string) => text }),
        fromPartial<KeybindingsManager>({
          matches: (data: string, keybinding: Keybinding) =>
            keybinding === 'tui.select.confirm' && data === '\r',
        }),
        (value) => {
          result = value
        },
      )

      renderedLines.push(...component.render(80))
      component.handleInput?.('\r')
      return result ?? fromAny<T, string | null>(null)
    })
    const ctx = fromPartial<ExtensionCommandContext>({
      hasUI: true,
      ui: { custom },
    })

    const result = await promptPrefilledText({
      ctx,
      title: 'Edit preset name',
      currentValue: 'Existing preset name',
    })

    expect(stripAnsi(renderedLines.join('\n'))).toContain('Existing preset name')
    expect(result).toBe('Existing preset name')
  })
})

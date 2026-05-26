import { Key, matchesKey, parseKey } from '@mariozechner/pi-tui'
import type { WaggleConfig, WagglePreset } from '@openwaggle/waggle-core'
import { singleTerminalLine, truncateTerminalLine } from './terminal-text'

const CONTROL_CENTER_VISIBLE_ROWS = 12
const CONTROL_CENTER_VISIBLE_DETAILS = 6
const HALF_DIVISOR = 2

export type WaggleMenuAction =
  | { readonly type: 'disable' }
  | { readonly type: 'activate-preset'; readonly preset: WagglePreset }
  | { readonly type: 'preset-actions'; readonly preset: WagglePreset; readonly active: boolean }
  | {
      readonly type: 'active-config-actions'
      readonly config: WaggleConfig
      readonly preset?: WagglePreset
    }
  | { readonly type: 'create-preset' }
  | { readonly type: 'manage-presets' }

export interface WaggleControlCenterRow {
  readonly label: string
  readonly details: readonly string[]
  readonly primaryAction: WaggleMenuAction
  readonly secondaryAction?: WaggleMenuAction
}

function isPrintableInput(data: string) {
  const key = parseKey(data)
  return key !== undefined && key.length === 1 && key >= ' ' && key !== '\u007f'
}

export function createWaggleControlCenterComponent(input: {
  readonly title: string
  readonly rows: readonly WaggleControlCenterRow[]
  readonly done: (action: WaggleMenuAction | undefined) => void
  readonly requestRender: () => void
}) {
  let selectedIndex = 0

  function selectedRow() {
    return input.rows[selectedIndex] ?? null
  }

  function moveSelected(delta: number) {
    if (input.rows.length === 0) return
    selectedIndex = (selectedIndex + delta + input.rows.length) % input.rows.length
    input.requestRender()
  }

  function renderRows() {
    const maxStartIndex = Math.max(0, input.rows.length - CONTROL_CENTER_VISIBLE_ROWS)
    const startIndex = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(CONTROL_CENTER_VISIBLE_ROWS / HALF_DIVISOR),
        maxStartIndex,
      ),
    )
    const visibleRows = input.rows.slice(startIndex, startIndex + CONTROL_CENTER_VISIBLE_ROWS)
    const renderedRows = visibleRows.map((row, offset) => {
      const absoluteIndex = startIndex + offset
      return `${absoluteIndex === selectedIndex ? '→' : ' '} ${row.label}`
    })
    while (renderedRows.length < CONTROL_CENTER_VISIBLE_ROWS) renderedRows.push('')
    return renderedRows
  }

  function renderDetails() {
    const details = [...(selectedRow()?.details ?? ['No Waggle presets available.'])]
      .slice(0, CONTROL_CENTER_VISIBLE_DETAILS)
      .map(singleTerminalLine)
    while (details.length < CONTROL_CENTER_VISIBLE_DETAILS) details.push('')
    return details
  }

  function renderLines() {
    return [
      input.title,
      '↑↓ navigate · enter select · space details/actions · escape/ctrl+c cancel',
      '',
      ...renderRows(),
      '',
      '──────────────── Waggle details ────────────────',
      ...renderDetails(),
    ]
  }

  return {
    invalidate() {
      return undefined
    },
    render(width: number) {
      return renderLines().map((line) => truncateTerminalLine(line, width))
    },
    handleInput(data: string) {
      if (matchesKey(data, Key.up) || matchesKey(data, 'k')) {
        moveSelected(-1)
        return
      }
      if (matchesKey(data, Key.down) || matchesKey(data, 'j')) {
        moveSelected(1)
        return
      }
      if (matchesKey(data, Key.enter)) {
        input.done(selectedRow()?.primaryAction)
        return
      }
      if (matchesKey(data, Key.space)) {
        const row = selectedRow()
        input.done(row?.secondaryAction ?? row?.primaryAction)
        return
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
        input.done(undefined)
        return
      }
      if (isPrintableInput(data)) {
        return
      }
    },
  }
}

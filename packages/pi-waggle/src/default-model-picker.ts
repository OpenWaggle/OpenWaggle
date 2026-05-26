import type { ExtensionCommandContext, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { decodeKittyPrintable, Key, matchesKey, parseKey } from '@mariozechner/pi-tui'
import { singleTerminalLine, truncateTerminalLine } from './terminal-text'

const MODEL_PICKER_VISIBLE_ROWS = 10
const MODEL_PICKER_DETAILS_ROWS = 3
const HALF_DIVISOR = 2
const MODEL_PICKER_OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: { anchor: 'top-left', row: 0, col: 0, width: '100%', maxHeight: '100%' },
} as const

interface ModelPickerItem {
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly reference: string
}

function modelReference(provider: string, id: string) {
  return `${provider}/${id}`
}

export function modelReferenceForCurrentModel(ctx: ExtensionContext) {
  return ctx.model ? modelReference(ctx.model.provider, ctx.model.id) : null
}

function modelPickerItems(ctx: ExtensionContext): readonly ModelPickerItem[] {
  if (typeof ctx.modelRegistry.getAvailable !== 'function') return []
  return ctx.modelRegistry
    .getAvailable()
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      name: model.name,
      reference: modelReference(model.provider, model.id),
    }))
    .sort(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.id.localeCompare(right.id),
    )
}

function filterModelItems(items: readonly ModelPickerItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return items
  return items.filter((item) =>
    `${item.id} ${item.provider} ${item.reference} ${item.name}`
      .toLowerCase()
      .includes(normalizedQuery),
  )
}

function isBackspace(data: string) {
  return matchesKey(data, Key.backspace)
}

function printableInput(data: string) {
  const key = decodeKittyPrintable(data) ?? parseKey(data) ?? data
  return key.length === 1 && key >= ' ' && key !== '\u007f' ? key : null
}

export function createModelPickerComponent(input: {
  readonly items: readonly ModelPickerItem[]
  readonly currentModelReference: string | null
  readonly done: (modelReference: string | undefined) => void
  readonly requestRender: () => void
}) {
  let selectedIndex = 0
  let query = ''
  let filteredItems = filterModelItems(input.items, query)

  function updateFilter(nextQuery: string) {
    query = nextQuery
    filteredItems = filterModelItems(input.items, query)
    selectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1))
    input.requestRender()
  }

  function moveSelected(delta: number) {
    if (filteredItems.length === 0) return
    selectedIndex = (selectedIndex + delta + filteredItems.length) % filteredItems.length
    input.requestRender()
  }

  function lines() {
    const maxStartIndex = Math.max(0, filteredItems.length - MODEL_PICKER_VISIBLE_ROWS)
    const startIndex = Math.max(
      0,
      Math.min(selectedIndex - Math.floor(MODEL_PICKER_VISIBLE_ROWS / HALF_DIVISOR), maxStartIndex),
    )
    const visibleItems = filteredItems.slice(startIndex, startIndex + MODEL_PICKER_VISIBLE_ROWS)
    const rendered = [
      'Select Waggle agent model',
      `Search: ${query}`,
      '────────────────────────────────────────',
    ]

    const renderedItems = visibleItems.map((item, offset) => {
      const absoluteIndex = startIndex + offset
      const selectedPrefix = absoluteIndex === selectedIndex ? '→' : ' '
      const currentMarker = item.reference === input.currentModelReference ? ' ✓' : ''
      return `${selectedPrefix} ${item.id} [${item.provider}]${currentMarker}`
    })
    if (filteredItems.length === 0) renderedItems.push('  No matching models')
    while (renderedItems.length < MODEL_PICKER_VISIBLE_ROWS) renderedItems.push('')
    rendered.push(...renderedItems)

    const current = filteredItems[selectedIndex]
    const detailRows = current
      ? ['', `Model name: ${current.name}`, `Reference: ${current.reference}`]
      : []
    while (detailRows.length < MODEL_PICKER_DETAILS_ROWS) detailRows.push('')
    rendered.push(...detailRows.map(singleTerminalLine))

    rendered.push('')
    rendered.push('↑↓ navigate · type to search · enter pin model · escape/ctrl+c cancel')
    return rendered
  }

  return {
    invalidate() {
      return undefined
    },
    render(width: number) {
      return lines().map((line) => truncateTerminalLine(line, width))
    },
    handleInput(data: string) {
      if (matchesKey(data, Key.up)) {
        moveSelected(-1)
        return
      }
      if (matchesKey(data, Key.down)) {
        moveSelected(1)
        return
      }
      if (matchesKey(data, Key.enter)) {
        input.done(filteredItems[selectedIndex]?.reference)
        return
      }
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
        input.done(undefined)
        return
      }
      if (isBackspace(data)) {
        updateFilter(query.slice(0, -1))
        return
      }
      const printable = printableInput(data)
      if (printable) updateFilter(`${query}${printable}`)
    },
  }
}

export async function selectConcreteModelReference(input: {
  readonly ctx: ExtensionCommandContext
  readonly currentModelReference: string | null
}) {
  if (!input.ctx.hasUI) return null

  const items = modelPickerItems(input.ctx)
  if (items.length > 0 && typeof input.ctx.ui.custom === 'function') {
    return input.ctx.ui.custom<string | undefined>(
      (tui, _theme, _keybindings, done) =>
        createModelPickerComponent({
          items,
          currentModelReference: input.currentModelReference,
          done,
          requestRender: () => tui.requestRender(),
        }),
      MODEL_PICKER_OVERLAY_OPTIONS,
    )
  }

  if (items.length > 0) {
    const labels = items.map((item) => {
      const currentMarker = item.reference === input.currentModelReference ? ' ✓' : ''
      return `${item.id} [${item.provider}]${currentMarker}`
    })
    const selected = await input.ctx.ui.select('Select Waggle agent model', labels)
    const selectedIndex = selected ? labels.indexOf(selected) : -1
    return selectedIndex >= 0 ? (items[selectedIndex]?.reference ?? null) : null
  }

  const typed = await input.ctx.ui.input(
    'Pin Waggle agent model (provider/modelId)',
    input.currentModelReference ?? modelReferenceForCurrentModel(input.ctx) ?? 'provider/modelId',
  )
  return typed?.trim() || null
}

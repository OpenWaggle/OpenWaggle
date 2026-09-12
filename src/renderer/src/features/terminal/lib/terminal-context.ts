import {
  escapeXml,
  limitText,
  normalizeMetadata,
  normalizeSelectedText,
  normalizeSingleLineMetadata,
  type TextMetrics,
  textMetrics,
} from './terminal-context-text'

export type TerminalContextProvenance =
  | 'session-worktree'
  | 'original-checkout'
  | 'opened-checkout'
  | 'draft-checkout'

export interface TerminalContextRange {
  readonly startLine: number
  readonly endLine: number
  readonly startColumn?: number | null
  readonly endColumn?: number | null
}

export interface TerminalContextSelection {
  readonly terminalId?: string | null
  readonly terminalLabel: string
  readonly cwd: string
  readonly provenance: TerminalContextProvenance
  readonly command?: string | null
  readonly range?: TerminalContextRange | null
  readonly selectedText: string
}

export interface TerminalContextLimits {
  readonly maxEntries: number
  readonly maxSelectedCharacters: number
  readonly maxSelectedBytes: number
  readonly maxLabelCharacters: number
  readonly maxCwdCharacters: number
  readonly maxCommandCharacters: number
  readonly maxTerminalIdCharacters: number
}

export const TERMINAL_CONTEXT_LIMITS: TerminalContextLimits = {
  maxEntries: 8,
  maxSelectedCharacters: 16_384,
  maxSelectedBytes: 32_768,
  maxLabelCharacters: 120,
  maxCwdCharacters: 2_048,
  maxCommandCharacters: 4_096,
  maxTerminalIdCharacters: 200,
}

export interface TerminalContextPayloadEntry {
  readonly terminalId: string | null
  readonly terminalLabel: string
  readonly cwd: string
  readonly provenance: TerminalContextProvenance
  readonly command: string | null
  readonly commandTruncated: boolean
  readonly range: TerminalContextRange | null
  readonly selectedText: string
  readonly selectedCharacters: number
  readonly selectedBytes: number
  readonly originalCharacters: number
  readonly originalBytes: number
  readonly truncated: boolean
}

export interface TerminalContextPayload {
  readonly xml: string
  readonly entries: readonly TerminalContextPayloadEntry[]
  readonly selectedCharacters: number
  readonly selectedBytes: number
  readonly originalCharacters: number
  readonly originalBytes: number
  readonly omittedEntries: number
  readonly truncated: boolean
}

function positiveSafeInteger(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const integer = Math.floor(value)
  return Number.isSafeInteger(integer) && integer >= 1 ? integer : null
}

function normalizeRange(
  range: TerminalContextRange | null | undefined,
): TerminalContextRange | null {
  if (range === null || range === undefined) return null
  const startLine = positiveSafeInteger(range.startLine)
  if (startLine === null) return null
  const requestedEndLine = positiveSafeInteger(range.endLine)
  const endLine = Math.max(startLine, requestedEndLine ?? startLine)
  const startColumn = positiveSafeInteger(range.startColumn)
  const requestedEndColumn = positiveSafeInteger(range.endColumn)
  const endColumn =
    startColumn === null
      ? requestedEndColumn
      : Math.max(startColumn, requestedEndColumn ?? startColumn)
  return { startLine, endLine, startColumn, endColumn }
}

function assertLimits(limits: TerminalContextLimits) {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`Terminal context ${name} must be a positive safe integer.`)
    }
  }
}

function metadataValue(value: string, limit: number) {
  const normalized = normalizeMetadata(value)
  return limitText(normalized, limit, Number.MAX_SAFE_INTEGER)
}

function normalizedEntryMetadata(
  selection: TerminalContextSelection,
  limits: TerminalContextLimits,
) {
  const terminalLabel = limitText(
    normalizeSingleLineMetadata(selection.terminalLabel),
    limits.maxLabelCharacters,
    Number.MAX_SAFE_INTEGER,
  ).text
  const cwd = metadataValue(selection.cwd, limits.maxCwdCharacters).text
  if (terminalLabel.length === 0 || cwd.length === 0) return null

  const terminalIdValue = selection.terminalId
  const terminalId =
    terminalIdValue === null || terminalIdValue === undefined
      ? null
      : limitText(
          normalizeSingleLineMetadata(terminalIdValue),
          limits.maxTerminalIdCharacters,
          Number.MAX_SAFE_INTEGER,
        ).text || null
  const rawCommand = selection.command
  const commandLimit =
    rawCommand === null || rawCommand === undefined
      ? null
      : metadataValue(rawCommand, limits.maxCommandCharacters)
  return {
    terminalId,
    terminalLabel,
    cwd,
    provenance: selection.provenance,
    command: commandLimit?.text || null,
    commandTruncated: commandLimit?.truncated ?? false,
    range: normalizeRange(selection.range),
  }
}

function rangeXml(range: TerminalContextRange | null) {
  if (range === null) return ''
  const attributes = [
    `start_line="${String(range.startLine)}"`,
    `end_line="${String(range.endLine)}"`,
  ]
  if (range.startColumn !== null && range.startColumn !== undefined) {
    attributes.push(`start_column="${String(range.startColumn)}"`)
  }
  if (range.endColumn !== null && range.endColumn !== undefined) {
    attributes.push(`end_column="${String(range.endColumn)}"`)
  }
  return `<range ${attributes.join(' ')} />`
}

function entryXml(entry: TerminalContextPayloadEntry) {
  const lines = ['<terminal>']
  if (entry.terminalId !== null) lines.push(`<id>${escapeXml(entry.terminalId)}</id>`)
  lines.push(`<label>${escapeXml(entry.terminalLabel)}</label>`)
  lines.push(`<cwd>${escapeXml(entry.cwd)}</cwd>`)
  lines.push(`<provenance>${entry.provenance}</provenance>`)
  if (entry.command !== null) {
    lines.push(
      `<command truncated="${String(entry.commandTruncated)}">${escapeXml(entry.command)}</command>`,
    )
  }
  const range = rangeXml(entry.range)
  if (range.length > 0) lines.push(range)
  lines.push(
    `<selected_output truncated="${String(entry.truncated)}" original_characters="${String(entry.originalCharacters)}" original_bytes="${String(entry.originalBytes)}" included_characters="${String(entry.selectedCharacters)}" included_bytes="${String(entry.selectedBytes)}">${escapeXml(entry.selectedText)}</selected_output>`,
  )
  lines.push('</terminal>')
  return lines.join('\n')
}

/**
 * Serializes selected terminal output as explicitly untrusted XML data. The
 * character and UTF-8 byte budgets apply across the complete payload, so
 * attaching more selections cannot bypass the cap.
 */
export function buildTerminalContextPayload(
  selections: readonly TerminalContextSelection[],
  limits: TerminalContextLimits = TERMINAL_CONTEXT_LIMITS,
): TerminalContextPayload | null {
  assertLimits(limits)

  const validSelections: Array<{
    readonly metadata: NonNullable<ReturnType<typeof normalizedEntryMetadata>>
    readonly text: string
    readonly metrics: TextMetrics
  }> = []
  for (const selection of selections) {
    const metadata = normalizedEntryMetadata(selection, limits)
    const text = normalizeSelectedText(selection.selectedText)
    if (metadata === null || text.trim().length === 0) continue
    validSelections.push({ metadata, text, metrics: textMetrics(text) })
  }
  if (validSelections.length === 0) return null

  const entries: TerminalContextPayloadEntry[] = []
  let remainingCharacters = limits.maxSelectedCharacters
  let remainingBytes = limits.maxSelectedBytes
  let originalCharacters = 0
  let originalBytes = 0
  for (const selection of validSelections) {
    originalCharacters += selection.metrics.characters
    originalBytes += selection.metrics.bytes
  }

  const includedSelections = validSelections.slice(0, limits.maxEntries)
  for (const selection of includedSelections) {
    const selected = limitText(selection.text, remainingCharacters, remainingBytes)
    remainingCharacters -= selected.characters
    remainingBytes -= selected.bytes
    entries.push({
      ...selection.metadata,
      selectedText: selected.text,
      selectedCharacters: selected.characters,
      selectedBytes: selected.bytes,
      originalCharacters: selection.metrics.characters,
      originalBytes: selection.metrics.bytes,
      truncated: selected.truncated,
    })
  }

  const selectedCharacters = limits.maxSelectedCharacters - remainingCharacters
  const selectedBytes = limits.maxSelectedBytes - remainingBytes
  const omittedEntries = validSelections.length - includedSelections.length
  const truncated =
    omittedEntries > 0 || selectedCharacters < originalCharacters || selectedBytes < originalBytes
  const body = entries.map(entryXml).join('\n')
  const xml = [
    `<terminal_context version="1" source="terminal_selection" trust="untrusted" truncated="${String(truncated)}" original_characters="${String(originalCharacters)}" original_bytes="${String(originalBytes)}" included_characters="${String(selectedCharacters)}" included_bytes="${String(selectedBytes)}" omitted_entries="${String(omittedEntries)}">`,
    body,
    '</terminal_context>',
  ].join('\n')

  return {
    xml,
    entries,
    selectedCharacters,
    selectedBytes,
    originalCharacters,
    originalBytes,
    omittedEntries,
    truncated,
  }
}

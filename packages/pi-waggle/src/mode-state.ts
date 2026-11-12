import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { WaggleConfig } from '@openwaggle/waggle-core'
import {
  createPiWaggleModeState,
  PI_WAGGLE_MODE_STATE_CUSTOM_TYPE,
  type PiWaggleModeState,
  parsePiWaggleModeState,
} from './protocol.js'

export interface PiWaggleModeStateWriter {
  readonly appendCustomEntry: (customType: string, data?: unknown) => string | undefined
}

export interface PiWaggleModeStateReader {
  readonly getBranch: () => readonly SessionEntry[]
}

export function enabledPiWaggleModeState(input: {
  readonly config: WaggleConfig
  readonly presetId?: string
  readonly updatedAt?: number
}) {
  return createPiWaggleModeState({
    enabled: true,
    ...(input.presetId ? { presetId: input.presetId } : {}),
    config: input.config,
    updatedAt: input.updatedAt ?? Date.now(),
  })
}

export function disabledPiWaggleModeState(input: { readonly updatedAt?: number } = {}) {
  return createPiWaggleModeState({
    enabled: false,
    updatedAt: input.updatedAt ?? Date.now(),
  })
}

export function appendPiWaggleModeState(writer: PiWaggleModeStateWriter, state: PiWaggleModeState) {
  return writer.appendCustomEntry(PI_WAGGLE_MODE_STATE_CUSTOM_TYPE, state)
}

function customEntryModeState(entry: SessionEntry) {
  if (entry.type !== 'custom' || entry.customType !== PI_WAGGLE_MODE_STATE_CUSTOM_TYPE) {
    return null
  }

  return parsePiWaggleModeState(entry.data)
}

export function latestPiWaggleModeStateFromEntries(entries: readonly SessionEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }

    const state = customEntryModeState(entry)
    if (state) {
      const result: PiWaggleModeState | null = state
      return result
    }
  }

  return null
}

export function latestPiWaggleModeStateFromBranch(sessionManager: PiWaggleModeStateReader) {
  return latestPiWaggleModeStateFromEntries(sessionManager.getBranch())
}

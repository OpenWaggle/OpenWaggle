import { matchBy } from '@diegogbrisa/ts-match'
import type {
  McpConfigSourceId,
  McpConfigSourceSummary,
  McpDoctorResult,
  McpSecretSummary,
  McpSettingsView,
} from '@shared/types/mcp'

type LoadState = 'idle' | 'loading' | 'saving'

export interface McpSectionState {
  readonly view: McpSettingsView | null
  readonly doctor: McpDoctorResult | null
  readonly secrets: readonly McpSecretSummary[]
  readonly selectedSourceId: McpConfigSourceId
  readonly rawEdits: Partial<Record<McpConfigSourceId, string>>
  readonly loadState: LoadState
  readonly error: string | null
}

type McpSectionAction =
  | { readonly type: 'load:start' }
  | { readonly type: 'load:success'; readonly view: McpSettingsView }
  | { readonly type: 'load:error'; readonly error: string }
  | { readonly type: 'doctor:success'; readonly doctor: McpDoctorResult }
  | { readonly type: 'secrets:success'; readonly secrets: readonly McpSecretSummary[] }
  | { readonly type: 'save:start' }
  | { readonly type: 'mutation:success'; readonly view: McpSettingsView }
  | {
      readonly type: 'source-save:success'
      readonly view: McpSettingsView
      readonly sourceId: McpConfigSourceId
    }
  | { readonly type: 'mutation:error'; readonly error: string }
  | { readonly type: 'source:select'; readonly sourceId: McpConfigSourceId }
  | {
      readonly type: 'raw-edit:change'
      readonly sourceId: McpConfigSourceId
      readonly rawJson: string
    }

export const MCP_SECTION_INITIAL_STATE: McpSectionState = {
  view: null,
  doctor: null,
  secrets: [],
  selectedSourceId: 'global-openwaggle',
  rawEdits: {},
  loadState: 'idle',
  error: null,
}

function withoutRawEdit(
  rawEdits: Partial<Record<McpConfigSourceId, string>>,
  sourceId: McpConfigSourceId,
) {
  const remainingEdits = { ...rawEdits }
  delete remainingEdits[sourceId]
  return remainingEdits
}

export function mcpSectionReducer(
  state: McpSectionState,
  action: McpSectionAction,
): McpSectionState {
  return matchBy(action, 'type')
    .with('load:start', () => ({ ...state, loadState: 'loading', error: null }))
    .with('load:success', (value) => ({
      ...state,
      view: value.view,
      rawEdits: {},
      loadState: 'idle',
      error: null,
    }))
    .with('load:error', (value) => ({ ...state, loadState: 'idle', error: value.error }))
    .with('doctor:success', (value) => ({ ...state, doctor: value.doctor }))
    .with('secrets:success', (value) => ({ ...state, secrets: value.secrets }))
    .with('save:start', () => ({ ...state, loadState: 'saving', error: null }))
    .with('mutation:success', (value) => ({
      ...state,
      view: value.view,
      loadState: 'idle',
      error: null,
    }))
    .with('source-save:success', (value) => ({
      ...state,
      view: value.view,
      rawEdits: withoutRawEdit(state.rawEdits, value.sourceId),
      loadState: 'idle',
      error: null,
    }))
    .with('mutation:error', (value) => ({ ...state, loadState: 'idle', error: value.error }))
    .with('source:select', (value) => ({ ...state, selectedSourceId: value.sourceId }))
    .with('raw-edit:change', (value) => ({
      ...state,
      rawEdits: { ...state.rawEdits, [value.sourceId]: value.rawJson },
    }))
    .exhaustive()
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sourceById(sources: readonly McpConfigSourceSummary[], sourceId: McpConfigSourceId) {
  return sources.find((source) => source.id === sourceId) ?? null
}

export function getSelectedSource(view: McpSettingsView, selectedSourceId: McpConfigSourceId) {
  return sourceById(view.sources, selectedSourceId) ?? view.sources[0] ?? null
}

import { matchBy } from '@diegogbrisa/ts-match'
import { MCP_ADAPTER_PACKAGE_SOURCE } from '@shared/constants/mcp'
import type {
  McpConfigSourceId,
  McpConfigSourceSummary,
  McpServerSummary,
  McpSettingsView,
} from '@shared/types/mcp'
import { AlertTriangle, CheckCircle2, FileJson2, Network, RotateCw } from 'lucide-react'
import { useEffect, useReducer } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { usePreferences } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'
import { useUIStore } from '@/stores/ui-store'

const RAW_EDITOR_ROWS = 16

type LoadState = 'idle' | 'loading' | 'saving'

interface McpSectionState {
  readonly view: McpSettingsView | null
  readonly selectedSourceId: McpConfigSourceId
  readonly rawEdits: Partial<Record<McpConfigSourceId, string>>
  readonly loadState: LoadState
  readonly error: string | null
}

type McpSectionAction =
  | { readonly type: 'load:start' }
  | { readonly type: 'load:success'; readonly view: McpSettingsView }
  | { readonly type: 'load:error'; readonly error: string }
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

const INITIAL_SELECTED_SOURCE_ID: McpConfigSourceId = 'global-standard'

const MCP_SECTION_INITIAL_STATE: McpSectionState = {
  view: null,
  selectedSourceId: INITIAL_SELECTED_SOURCE_ID,
  rawEdits: {},
  loadState: 'idle',
  error: null,
}

function withoutRawEdit(
  rawEdits: Partial<Record<McpConfigSourceId, string>>,
  sourceId: McpConfigSourceId,
): Partial<Record<McpConfigSourceId, string>> {
  const remainingEdits = { ...rawEdits }
  delete remainingEdits[sourceId]
  return remainingEdits
}

function mcpSectionReducer(state: McpSectionState, action: McpSectionAction): McpSectionState {
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
      rawEdits: {
        ...state.rawEdits,
        [value.sourceId]: value.rawJson,
      },
    }))
    .exhaustive()
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sourceById(
  sources: readonly McpConfigSourceSummary[],
  sourceId: McpConfigSourceId,
): McpConfigSourceSummary | null {
  return sources.find((source) => source.id === sourceId) ?? null
}

function getSelectedSource(
  view: McpSettingsView,
  selectedSourceId: McpConfigSourceId,
): McpConfigSourceSummary | null {
  return sourceById(view.sources, selectedSourceId) ?? view.sources[0] ?? null
}

function formatServerDetail(server: McpServerSummary): string {
  if (server.transport === 'http' && server.url) {
    return server.url
  }
  if (server.transport === 'stdio' && server.command) {
    return server.command
  }
  return 'No transport configured'
}

function formatDirectTools(mode: McpServerSummary['directTools']): string {
  if (mode === 'enabled') {
    return 'Direct tools'
  }
  if (mode === 'partial') {
    return 'Selected direct tools'
  }
  if (mode === 'disabled') {
    return 'Proxy only'
  }
  return 'Inherits direct-tools setting'
}

function SourceButton({
  source,
  selected,
  onSelect,
}: {
  readonly source: McpConfigSourceSummary
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const statusLabel = source.parseError ? 'Invalid' : source.exists ? 'Found' : 'Empty'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        selected
          ? 'border-accent/40 bg-accent/5 text-text-primary'
          : 'border-border bg-bg hover:border-border-light text-text-secondary',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{source.label}</div>
          <div className="mt-1 truncate text-[11px] text-text-muted">{source.path}</div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            source.parseError
              ? 'bg-error/10 text-error'
              : source.exists
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-bg-tertiary text-text-muted',
          )}
        >
          {statusLabel}
        </span>
      </div>
      {source.parseError ? (
        <div className="mt-2 line-clamp-2 text-[11px] text-error">{source.parseError}</div>
      ) : (
        <div className="mt-2 flex gap-2 text-[11px] text-text-tertiary">
          <span>{source.serverCount} active</span>
          <span>{source.disabledServerCount} disabled</span>
        </div>
      )}
    </button>
  )
}

function ServerRow({
  server,
  busy,
  onToggle,
}: {
  readonly server: McpServerSummary
  readonly busy: boolean
  readonly onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-primary">{server.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              server.enabled
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-bg-tertiary text-text-muted',
            )}
          >
            {server.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
            {formatDirectTools(server.directTools)}
          </span>
        </div>
        <div className="mt-1 truncate text-[12px] text-text-tertiary">
          {formatServerDetail(server)}
        </div>
        <div className="mt-1 truncate text-[11px] text-text-muted">
          Source: {server.sourceLabel}
        </div>
      </div>
      <ToggleSwitch
        checked={server.enabled}
        disabled={busy}
        label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

function useMcpSectionController(projectPath: string | null) {
  const [state, dispatch] = useReducer(mcpSectionReducer, MCP_SECTION_INITIAL_STATE)
  const showToast = useUIStore((state) => state.showToast)
  const { view, selectedSourceId, rawEdits, loadState, error } = state

  useEffect(() => {
    let active = true

    async function load(): Promise<void> {
      dispatch({ type: 'load:start' })
      try {
        const nextView = await api.getMcpSettings(projectPath)
        if (!active) return
        dispatch({ type: 'load:success', view: nextView })
      } catch (loadError) {
        if (!active) return
        dispatch({ type: 'load:error', error: getErrorMessage(loadError) })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [projectPath])

  async function refresh(): Promise<void> {
    dispatch({ type: 'load:start' })
    try {
      dispatch({ type: 'load:success', view: await api.getMcpSettings(projectPath) })
    } catch (refreshError) {
      dispatch({ type: 'load:error', error: getErrorMessage(refreshError) })
    }
  }

  async function toggleAdapter(): Promise<void> {
    if (!view) return
    dispatch({ type: 'save:start' })
    try {
      dispatch({
        type: 'mutation:success',
        view: await api.setMcpAdapterEnabled(!view.adapter.enabled, projectPath),
      })
    } catch (toggleError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(toggleError) })
    }
  }

  async function toggleServer(server: McpServerSummary): Promise<void> {
    dispatch({ type: 'save:start' })
    try {
      const nextView = await api.setMcpServerEnabled({
        projectPath,
        sourceId: server.sourceId,
        serverName: server.name,
        enabled: !server.enabled,
      })
      dispatch({ type: 'mutation:success', view: nextView })
    } catch (toggleError) {
      dispatch({ type: 'mutation:error', error: getErrorMessage(toggleError) })
    }
  }

  async function saveSelectedSource(): Promise<void> {
    if (!view) return
    const selectedSource = getSelectedSource(view, selectedSourceId)
    if (!selectedSource) return

    dispatch({ type: 'save:start' })
    try {
      const nextView = await api.writeMcpSourceConfig({
        projectPath,
        sourceId: selectedSource.id,
        rawJson: rawEdits[selectedSource.id] ?? selectedSource.rawJson,
      })
      dispatch({ type: 'source-save:success', view: nextView, sourceId: selectedSource.id })
      showToast('MCP JSON saved.', 'success')
    } catch (saveError) {
      const message = getErrorMessage(saveError)
      dispatch({ type: 'mutation:error', error: message })
      showToast(`MCP JSON was not saved: ${message}`, 'error')
    }
  }

  const selectedSource = view ? getSelectedSource(view, selectedSourceId) : null
  const rawJson = selectedSource ? (rawEdits[selectedSource.id] ?? selectedSource.rawJson) : ''
  const busy = loadState !== 'idle'

  return {
    view,
    error,
    selectedSource,
    rawJson,
    busy,
    refresh,
    toggleAdapter,
    toggleServer,
    saveSelectedSource,
    selectSource: (sourceId: McpConfigSourceId) => dispatch({ type: 'source:select', sourceId }),
    updateRawJson: (sourceId: McpConfigSourceId, rawJson: string) =>
      dispatch({ type: 'raw-edit:change', sourceId, rawJson }),
  }
}

function McpSectionHeading() {
  return (
    <div className="space-y-1">
      <h2 className="text-[20px] font-semibold text-text-primary">MCP</h2>
      <p className="max-w-[760px] text-[13px] leading-5 text-text-tertiary">
        MCP support is powered by a Pi extension package. OpenWaggle manages the effective config
        hierarchy and Pi picks up changes on the next turn.
      </p>
    </div>
  )
}

function McpErrorAlert({ message }: { readonly message: string | null | undefined }) {
  if (!message) {
    return null
  }

  return (
    <p
      role="alert"
      className="rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error"
    >
      {message}
    </p>
  )
}

function McpAdapterStatus({ enabled }: { readonly enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300">
      <CheckCircle2 className="size-3" />
      Enabled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-muted">
      <AlertTriangle className="size-3" />
      Off
    </span>
  )
}

function McpAdapterCard({
  view,
  busy,
  onRefresh,
  onToggle,
}: {
  readonly view: McpSettingsView | null
  readonly busy: boolean
  readonly onRefresh: () => void
  readonly onToggle: () => void
}) {
  const adapterEnabled = view?.adapter.enabled ?? false
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Network className="size-4 text-accent" />
            <h3 className="text-[16px] font-semibold text-text-primary">Pi MCP extension</h3>
            <McpAdapterStatus enabled={adapterEnabled} />
          </div>
          <p className="text-[12px] text-text-tertiary">
            Package source: {view?.adapter.packageSource ?? MCP_ADAPTER_PACKAGE_SOURCE}
          </p>
          {view?.runtimeConfigPath && (
            <p className="truncate text-[11px] text-text-muted">
              Runtime bridge config: {view.runtimeConfigPath}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button disabled={busy} onClick={onRefresh} leftIcon={<RotateCw className="size-3" />}>
            Refresh
          </Button>
          <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-1.5">
            <span className="text-[12px] font-medium text-text-secondary">
              {adapterEnabled ? 'On' : 'Off'}
            </span>
            <ToggleSwitch
              checked={adapterEnabled}
              disabled={!view || busy}
              label={`${adapterEnabled ? 'Disable' : 'Enable'} Pi MCP extension`}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function McpSourcesPanel({
  sources,
  selectedSource,
  onSelectSource,
}: {
  readonly sources: readonly McpConfigSourceSummary[]
  readonly selectedSource: McpConfigSourceSummary | null
  readonly onSelectSource: (sourceId: McpConfigSourceId) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[16px] font-semibold text-text-primary">Sources</h3>
      <div className="grid grid-cols-2 gap-3">
        {sources.map((source) => (
          <SourceButton
            key={source.id}
            source={source}
            selected={selectedSource?.id === source.id}
            onSelect={() => onSelectSource(source.id)}
          />
        ))}
      </div>
    </div>
  )
}

function McpServersPanel({
  servers,
  busy,
  onToggleServer,
}: {
  readonly servers: readonly McpServerSummary[]
  readonly busy: boolean
  readonly onToggleServer: (server: McpServerSummary) => void
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[16px] font-semibold text-text-primary">Effective servers</h3>
      <div className="overflow-hidden rounded-lg border border-border bg-[#111418]">
        {servers.length > 0 ? (
          servers.map((server) => (
            <ServerRow
              key={`${server.sourceId}:${server.name}`}
              server={server}
              busy={busy}
              onToggle={() => onToggleServer(server)}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-[13px] text-text-muted">No MCP servers configured.</p>
        )}
      </div>
    </div>
  )
}

function McpSourceEditor({
  selectedSource,
  rawJson,
  busy,
  onSave,
  onRawJsonChange,
}: {
  readonly selectedSource: McpConfigSourceSummary | null
  readonly rawJson: string
  readonly busy: boolean
  readonly onSave: () => void
  readonly onRawJsonChange: (sourceId: McpConfigSourceId, rawJson: string) => void
}) {
  return (
    <div className="rounded-lg border border-border bg-[#111418] p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileJson2 className="size-4 text-text-tertiary" />
            <h3 className="text-[16px] font-semibold text-text-primary">Edit selected source</h3>
          </div>
          <p className="mt-1 truncate text-[12px] text-text-tertiary">
            {selectedSource ? selectedSource.path : 'Select a source'}
          </p>
          {selectedSource?.parseError && (
            <p
              role="alert"
              className="mt-2 rounded-md border border-error/25 bg-error/6 px-3 py-2 text-[12px] text-error"
            >
              {selectedSource.parseError}
            </p>
          )}
        </div>
        <Button variant="accent" disabled={!selectedSource || busy} onClick={onSave}>
          Save JSON
        </Button>
      </div>
      <Textarea
        value={rawJson}
        rows={RAW_EDITOR_ROWS}
        spellCheck={false}
        variant="mono"
        resize="vertical"
        wrap="off"
        highlightLanguage="json"
        onChange={(event) => {
          if (!selectedSource) return
          onRawJsonChange(selectedSource.id, event.target.value)
        }}
      />
      <p className="mt-2 text-[11px] text-text-muted">
        Advanced config is preserved as JSON so every `pi-mcp-adapter` server and settings field
        remains available.
      </p>
    </div>
  )
}

export function McpSection() {
  const { settings } = usePreferences()
  const controller = useMcpSectionController(settings.projectPath)
  const sources = controller.view?.sources ?? []
  const servers = controller.view?.servers ?? []

  return (
    <div className="space-y-6">
      <McpSectionHeading />
      <McpErrorAlert message={controller.error} />
      <McpErrorAlert message={controller.view?.adapter.lastError} />
      <McpAdapterCard
        view={controller.view}
        busy={controller.busy}
        onRefresh={() => void controller.refresh()}
        onToggle={() => void controller.toggleAdapter()}
      />
      <McpSourcesPanel
        sources={sources}
        selectedSource={controller.selectedSource}
        onSelectSource={controller.selectSource}
      />
      <McpServersPanel
        servers={servers}
        busy={controller.busy}
        onToggleServer={(server) => void controller.toggleServer(server)}
      />
      <McpSourceEditor
        selectedSource={controller.selectedSource}
        rawJson={controller.rawJson}
        busy={controller.busy}
        onSave={() => void controller.saveSelectedSource()}
        onRawJsonChange={controller.updateRawJson}
      />
    </div>
  )
}

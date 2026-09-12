import {
  BROWSER_IMPORT_FAILURE_COPY,
  type BrowserImportSource,
  type BrowserImportTarget,
  type GuidedBrowserImportResult,
} from '@shared/types/browser-import'
import {
  BROWSER_PROFILE_LIMITS,
  type BrowserProfile,
  isBuiltInBrowserProfileId,
} from '@shared/types/browser-profile'
import { Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { BrowserImportWizard } from './BrowserImportWizard'

interface BrowserCookieImportCardProps {
  readonly profiles: readonly BrowserProfile[]
}

function actionableSources(sources: readonly BrowserImportSource[]) {
  return sources.filter(
    (source) =>
      source.unavailable !== 'not-installed' && source.unavailable !== 'unsupported-platform',
  )
}

function needsSettingsRefresh(outcome: GuidedBrowserImportResult) {
  return (
    (outcome.ok && outcome.createdProfile !== null) ||
    (!outcome.ok &&
      (outcome.reason === 'profile-limit-reached' || outcome.reason === 'unknown-target-profile'))
  )
}

function useBrowserCookieImportModel(profiles: readonly BrowserProfile[]) {
  const loadSettings = usePreferencesStore((state) => state.loadSettings)
  const [sources, setSources] = useState<readonly BrowserImportSource[] | null>(null)
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [activeSource, setActiveSource] = useState<BrowserImportSource | null>(null)
  const [discoveryError, setDiscoveryError] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const refreshInFlight = useRef<Promise<readonly BrowserImportSource[]> | null>(null)
  const importInFlight = useRef(false)
  const mounted = useRef(true)

  const loadSources = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current
    setRefreshing(true)
    setDiscoveryError(undefined)
    const request = api
      .listBrowserImportSources()
      .then((discovered) => {
        if (!mounted.current) return discovered
        setSources(discovered)
        const importable = actionableSources(discovered)
        setSelectedSourceId((current) =>
          importable.some((source) => source.id === current) ? current : (importable[0]?.id ?? ''),
        )
        return discovered
      })
      .catch((error: unknown) => {
        if (!mounted.current) return []
        setSources((current) => current ?? [])
        setDiscoveryError(
          error instanceof Error
            ? error.message
            : 'Installed browsers could not be discovered. Try again.',
        )
        return []
      })
      .finally(() => {
        refreshInFlight.current = null
        if (mounted.current) setRefreshing(false)
      })
    refreshInFlight.current = request
    return request
  }, [])

  useEffect(() => {
    mounted.current = true
    void loadSources()
    return () => {
      mounted.current = false
    }
  }, [loadSources])

  const importable = useMemo(() => actionableSources(sources ?? []), [sources])
  const selectedSource = importable.find((source) => source.id === selectedSourceId)
  const targets = profiles.filter((profile) => profile.kind === 'persistent')
  const canCreateProfile =
    profiles.filter((profile) => !isBuiltInBrowserProfileId(profile.id)).length <
    BROWSER_PROFILE_LIMITS.USER_PROFILES

  async function importCookies(input: {
    readonly sourceProfileDirectory: string
    readonly target: BrowserImportTarget
  }): Promise<GuidedBrowserImportResult> {
    if (!activeSource) {
      return {
        ok: false,
        reason: 'unknown-source',
        message: BROWSER_IMPORT_FAILURE_COPY['unknown-source'],
      }
    }
    if (importInFlight.current) {
      return {
        ok: false,
        reason: 'read-failed',
        message: BROWSER_IMPORT_FAILURE_COPY['read-failed'],
      }
    }
    importInFlight.current = true
    try {
      const outcome = await api.guidedImportBrowserCookies({
        sourceId: activeSource.id,
        sourceProfileDirectory: input.sourceProfileDirectory,
        target: input.target,
      })
      if (needsSettingsRefresh(outcome)) await loadSettings()
      return outcome
    } finally {
      importInFlight.current = false
    }
  }

  return {
    activeSource,
    canCreateProfile,
    discoveryError,
    importable,
    refreshing,
    selectedSource,
    selectedSourceId,
    sources,
    targets,
    importCookies,
    loadSources,
    refreshActiveSource: async () =>
      (await loadSources()).find((source) => source.id === activeSource?.id),
    setActiveSource,
    setSelectedSourceId,
  }
}

type BrowserCookieImportModel = ReturnType<typeof useBrowserCookieImportModel>

function BrowserImportLauncher({ model }: { readonly model: BrowserCookieImportModel }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label
          htmlFor="browser-import-source"
          className="min-w-0 flex-1 space-y-1 text-xs text-text-tertiary"
        >
          <span>Import from</span>
          <Select
            id="browser-import-source"
            aria-label="Import from browser"
            className="w-full"
            value={model.selectedSourceId}
            disabled={model.sources === null || model.refreshing || model.importable.length === 0}
            onChange={(event) => model.setSelectedSourceId(event.currentTarget.value)}
          >
            <option value="">
              {model.sources === null
                ? 'Looking for browsers…'
                : model.importable.length === 0
                  ? 'No supported browsers found'
                  : 'Choose browser'}
            </option>
            {model.importable.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex shrink-0 justify-end gap-2">
          <Button
            size="icon-md"
            variant="ghost"
            aria-label="Refresh installed browsers"
            disabled={model.refreshing}
            onClick={() => void model.loadSources()}
          >
            <RefreshCw className={model.refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </Button>
          <Button
            variant="primary"
            disabled={!model.selectedSource}
            onClick={() => {
              if (model.selectedSource) model.setActiveSource(model.selectedSource)
            }}
          >
            <Download className="size-3.5" />
            Continue
          </Button>
        </div>
      </div>
      {model.discoveryError ? (
        <p role="alert" className="mt-3 text-xs text-error-text">
          {model.discoveryError}
        </p>
      ) : null}
    </div>
  )
}

export function BrowserCookieImportCard({ profiles }: BrowserCookieImportCardProps) {
  const model = useBrowserCookieImportModel(profiles)
  return (
    <section className="space-y-3" aria-labelledby="cookie-import-heading">
      <div>
        <h3 id="cookie-import-heading" className="text-base font-semibold text-text-primary">
          Import browser logins
        </h3>
        <p className="text-xs text-text-tertiary">
          Copy compatible cookies once. Your source browser data is never modified.
        </p>
      </div>
      <BrowserImportLauncher model={model} />
      {model.activeSource ? (
        <BrowserImportWizard
          source={model.activeSource}
          targetProfiles={model.targets}
          canCreateProfile={model.canCreateProfile}
          onImport={model.importCookies}
          onRefreshSource={model.refreshActiveSource}
          onOpenFullDiskAccessSettings={() => api.openBrowserImportFullDiskAccessSettings()}
          onClose={() => model.setActiveSource(null)}
        />
      ) : null}
    </section>
  )
}

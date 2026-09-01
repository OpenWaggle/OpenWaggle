import { matchBy } from '@diegogbrisa/ts-match'
import { PERCENT_BASE } from '@shared/constants/math'
import type { UpdateStatus } from '@shared/types/updater'
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { AgentAccessSection } from './AgentAccessSection'

const logger = createRendererLogger('settings')
const MIN_COMPACTION_THRESHOLD_PERCENT = 1

function useAppVersion() {
  const [version, setVersion] = useState('…')
  useEffect(() => {
    if (typeof api.getAppVersion !== 'function') return
    api
      .getAppVersion()
      .then(setVersion)
      .catch((err: unknown) => {
        logger.warn('Failed to load app version', { error: String(err) })
      })
  }, [])
  return version
}

function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>({ type: 'idle' })

  useEffect(() => {
    if (typeof api.getUpdateStatus !== 'function') return
    api
      .getUpdateStatus()
      .then(setStatus)
      .catch((err: unknown) => {
        logger.warn('Failed to load update status', { error: String(err) })
      })
  }, [])

  useEffect(() => {
    if (typeof api.onUpdateStatus !== 'function') return
    return api.onUpdateStatus(setStatus)
  }, [])

  return status
}

interface StatusRow {
  subtitle: string
  subtitleClass: string
  dotClass: string | null
}

const UP_TO_DATE: StatusRow = {
  subtitle: 'You are up to date',
  subtitleClass: 'text-text-tertiary',
  dotClass: null,
}

function getStatusRow(status: UpdateStatus) {
  return matchBy(status, 'type')
    .with('idle', () => UP_TO_DATE)
    .with('not-available', () => UP_TO_DATE)
    .with('checking', () => ({
      subtitle: 'Checking for updates…',
      subtitleClass: 'text-text-tertiary',
      dotClass: null,
    }))
    .with('available', (s) => ({
      subtitle: `Downloading v${s.version}…`,
      subtitleClass: 'text-info-text',
      dotClass: 'bg-info',
    }))
    .with('downloading', (s) => ({
      subtitle: `Downloading v${s.version}… ${Math.round(s.percent)}%`,
      subtitleClass: 'text-info-text',
      dotClass: 'bg-info',
    }))
    .with('downloaded', (s) => ({
      subtitle: `v${s.version} ready to install`,
      subtitleClass: 'text-success',
      dotClass: 'bg-success',
    }))
    .with('error', () => ({
      subtitle: 'Update check failed',
      subtitleClass: 'text-error-text',
      dotClass: 'bg-error',
    }))
    .exhaustive()
}

function CompactionThresholdSetting() {
  const compactionThresholdPercent = usePreferencesStore(
    (state) => state.settings.compactionThresholdPercent,
  )
  const setCompactionThresholdPercent = usePreferencesStore(
    (state) => state.setCompactionThresholdPercent,
  )
  const [compactionThresholdDraft, setCompactionThresholdDraft] = useState(
    String(compactionThresholdPercent),
  )
  const [isPersistingCompactionThreshold, setIsPersistingCompactionThreshold] = useState(false)
  const isPersistingCompactionThresholdRef = useRef(false)

  useEffect(() => {
    setCompactionThresholdDraft(String(compactionThresholdPercent))
  }, [compactionThresholdPercent])

  const commitCompactionThreshold = () => {
    if (isPersistingCompactionThresholdRef.current) return

    const percent = Number(compactionThresholdDraft)
    const isValid =
      Number.isInteger(percent) &&
      percent >= MIN_COMPACTION_THRESHOLD_PERCENT &&
      percent <= PERCENT_BASE

    if (!isValid) {
      setCompactionThresholdDraft(String(compactionThresholdPercent))
      return
    }

    setCompactionThresholdDraft(String(percent))
    if (percent === compactionThresholdPercent) return
    isPersistingCompactionThresholdRef.current = true
    setIsPersistingCompactionThreshold(true)
    void setCompactionThresholdPercent(percent)
      .catch(() => {
        setCompactionThresholdDraft(String(compactionThresholdPercent))
      })
      .finally(() => {
        isPersistingCompactionThresholdRef.current = false
        setIsPersistingCompactionThreshold(false)
      })
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-text-primary">Context compaction</h3>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor="compaction-threshold-percent"
              className="text-xs font-medium text-text-primary"
            >
              Automatic compaction threshold
            </label>
            <span id="compaction-threshold-description" className="text-xs text-text-tertiary">
              Compact before the next model request when context reaches this percentage.
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <TextInput
              id="compaction-threshold-percent"
              aria-describedby="compaction-threshold-description"
              type="number"
              inputMode="numeric"
              min={MIN_COMPACTION_THRESHOLD_PERCENT}
              max={PERCENT_BASE}
              step={1}
              disabled={isPersistingCompactionThreshold}
              value={compactionThresholdDraft}
              onChange={(event) => setCompactionThresholdDraft(event.currentTarget.value)}
              onBlur={commitCompactionThreshold}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              inputSize="sm"
              className="w-16 text-right tabular-nums"
            />
            <span className="text-xs text-text-secondary">%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function GeneralSection() {
  const version = useAppVersion()
  const status = useUpdateStatus()
  const statusRow = getStatusRow(status)

  const canCheck =
    status.type === 'idle' || status.type === 'not-available' || status.type === 'error'
  const isDownloaded = status.type === 'downloaded'
  const isChecking = status.type === 'checking'

  return (
    <div className="space-y-6">
      <AgentAccessSection />

      <CompactionThresholdSetting />

      {/* About & Updates — title outside the card */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">About & Updates</h3>

        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          {/* Row 1 — Version */}
          <div className="flex h-14 items-center justify-between border-b border-border px-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-text-primary">Version</span>
              <span className="text-xs text-text-tertiary">OpenWaggle v{version}</span>
            </div>
          </div>

          {/* Row 2 — Latest version / status */}
          <div className="flex h-14 items-center justify-between px-5">
            <div className="flex items-center gap-2">
              {statusRow.dotClass ? (
                <div className={`size-2 shrink-0 rounded-full ${statusRow.dotClass}`} />
              ) : isChecking ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-text-tertiary" />
              ) : null}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-text-primary">Latest version</span>
                <span className={`text-xs ${statusRow.subtitleClass}`}>{statusRow.subtitle}</span>
              </div>
            </div>
            <div>
              {canCheck && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    if (typeof api.checkForUpdates === 'function') {
                      api.checkForUpdates().catch((err: unknown) => {
                        logger.warn('Failed to check for updates', { error: String(err) })
                      })
                    }
                  }}
                  className="h-7 border-border-light bg-bg-secondary text-text-secondary hover:bg-bg-hover"
                >
                  <RefreshCw className="size-3" />
                  Check now
                </Button>
              )}
              {isDownloaded && (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => {
                    if (typeof api.installUpdate === 'function') {
                      api.installUpdate().catch((err: unknown) => {
                        logger.warn('Failed to install update', { error: String(err) })
                      })
                    }
                  }}
                  className="h-7 bg-accent text-bg hover:bg-accent-dim"
                >
                  <RotateCcw className="size-3" />
                  Restart to update
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

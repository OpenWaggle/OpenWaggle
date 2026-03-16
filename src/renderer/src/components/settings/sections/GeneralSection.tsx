import type { UpdateStatus } from '@shared/types/updater'
import { chooseBy } from '@shared/utils/decision'
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'

function useAppVersion(): string {
  const [version, setVersion] = useState('…')
  useEffect(() => {
    if (typeof api.getAppVersion !== 'function') return
    api
      .getAppVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])
  return version
}

function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ type: 'idle' })

  useEffect(() => {
    if (typeof api.getUpdateStatus !== 'function') return
    api
      .getUpdateStatus()
      .then(setStatus)
      .catch(() => {})
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
  subtitleClass: 'text-[#9098a8]',
  dotClass: null,
}

function getStatusRow(status: UpdateStatus): StatusRow {
  return chooseBy(status, 'type')
    .case('idle', () => UP_TO_DATE)
    .case('not-available', () => UP_TO_DATE)
    .case('checking', () => ({
      subtitle: 'Checking for updates…',
      subtitleClass: 'text-[#9098a8]',
      dotClass: null,
    }))
    .case('available', (s) => ({
      subtitle: `Downloading v${s.version}…`,
      subtitleClass: 'text-[#61a8ff]',
      dotClass: 'bg-[#61a8ff]',
    }))
    .case('downloading', (s) => ({
      subtitle: `Downloading v${s.version}… ${Math.round(s.percent)}%`,
      subtitleClass: 'text-[#61a8ff]',
      dotClass: 'bg-[#61a8ff]',
    }))
    .case('downloaded', (s) => ({
      subtitle: `v${s.version} ready to install`,
      subtitleClass: 'text-[#4caf72]',
      dotClass: 'bg-[#4caf72]',
    }))
    .case('error', () => ({
      subtitle: 'Update check failed',
      subtitleClass: 'text-[#ef4444]',
      dotClass: 'bg-[#ef4444]',
    }))
    .assertComplete()
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
      {/* About & Updates — title outside the card */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-[#e7e9ee]">About & Updates</h3>

        <div className="overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]">
          {/* Row 1 — Version */}
          <div className="flex h-14 items-center justify-between border-b border-[#1e2229] px-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-[#e7e9ee]">Version</span>
              <span className="text-[12px] text-[#9098a8]">OpenWaggle v{version}</span>
            </div>
          </div>

          {/* Row 2 — Latest version / status */}
          <div className="flex h-14 items-center justify-between px-5">
            <div className="flex items-center gap-2">
              {statusRow.dotClass ? (
                <div className={`h-2 w-2 shrink-0 rounded-full ${statusRow.dotClass}`} />
              ) : isChecking ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#9098a8]" />
              ) : null}
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-[#e7e9ee]">Latest version</span>
                <span className={`text-[12px] ${statusRow.subtitleClass}`}>
                  {statusRow.subtitle}
                </span>
              </div>
            </div>
            <div>
              {canCheck && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof api.checkForUpdates === 'function') {
                      api.checkForUpdates().catch(() => {})
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#2a2f3a] bg-[#1a1f28] px-3 text-[12px] font-medium text-[#c9cdd6] transition-colors hover:bg-[#222830]"
                >
                  <RefreshCw className="h-3 w-3" />
                  Check now
                </button>
              )}
              {isDownloaded && (
                <button
                  type="button"
                  onClick={() => {
                    if (typeof api.installUpdate === 'function') {
                      api.installUpdate().catch(() => {})
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[5px] bg-[#f5a623] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#e09520]"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restart to update
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

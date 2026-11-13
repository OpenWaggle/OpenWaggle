import { matchBy } from '@diegogbrisa/ts-match'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { PERCENT_BASE } from '@shared/constants/math'
import type { BrowserEngineFailureReason, BrowserEngineStatus } from '@shared/types/browser-engine'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'
import { ensureBrowserEngine, useBrowserEngineStore } from '../state/browser-engine-store'

const BYTES_PER_MEGABYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE
/** One decimal below ten megabytes ("2.4"), whole megabytes above ("312"). */
const ONE_DECIMAL_BELOW_MB = 10

const FAILURE_HINTS: Readonly<Record<BrowserEngineFailureReason, string>> = {
  offline: 'Check your connection and try again.',
  http: 'The download server did not answer. Try again later.',
  integrity: 'The download was incomplete or damaged. Try again.',
  install: 'OpenWaggle could not set it up on this Mac.',
}

function megabytes(bytes: number) {
  const value = bytes / BYTES_PER_MEGABYTE
  return value.toFixed(value < ONE_DECIMAL_BELOW_MB ? 1 : 0)
}

function Overlay({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center"
      data-browser-engine-status
    >
      {children}
    </div>
  )
}

function Downloading({ receivedBytes, totalBytes }: { receivedBytes: number; totalBytes: number }) {
  const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * PERCENT_BASE) : 0
  return (
    <Overlay>
      <p className="text-sm font-medium text-text-primary">Downloading the browser engine</p>
      <div
        role="progressbar"
        aria-label="Browser engine download"
        aria-valuemin={0}
        aria-valuemax={PERCENT_BASE}
        aria-valuenow={percent}
        className="h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-bg-tertiary"
      >
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p className="text-xs tabular-nums text-text-tertiary">
        {megabytes(receivedBytes)} of {megabytes(totalBytes)} MB
      </p>
    </Overlay>
  )
}

function Failed({ reason, message }: { reason: BrowserEngineFailureReason; message: string }) {
  return (
    <Overlay>
      <p className="text-sm font-medium text-text-primary">
        The browser engine could not be installed
      </p>
      <p className="max-w-md text-xs text-text-tertiary">{FAILURE_HINTS[reason]}</p>
      {reason === 'offline' ? null : (
        <p className="max-w-md text-xs text-text-tertiary">{message}</p>
      )}
      <Button size="sm" variant="secondary" onClick={() => void ensureBrowserEngine()}>
        Retry
      </Button>
    </Overlay>
  )
}

function statusView(status: BrowserEngineStatus) {
  return matchBy(status, 'type')
    .with('downloading', (downloading) => <Downloading {...downloading} />)
    .with('installing', () => (
      <Overlay>
        <Spinner size="md" className="text-text-tertiary" />
        <p className="text-sm font-medium text-text-primary">Installing the browser engine</p>
      </Overlay>
    ))
    .with('failed', (failed) => <Failed reason={failed.reason} message={failed.message} />)
    .with('idle', 'checking', 'ready', () => null)
    .exhaustive()
}

/**
 * Covers the preview while its engine downloads or installs (macOS installs it on first use), and
 * offers a retry when that failed. The preview opens by itself once the engine is ready.
 */
export function BrowserEngineStatusOverlay() {
  const status = useBrowserEngineStore((state) => state.status)
  return statusView(status)
}

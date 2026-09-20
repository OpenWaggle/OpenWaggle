import type { CliShimStatus } from '@shared/types/cli-shim'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('settings')

function statusDetail(status: CliShimStatus | null) {
  if (status?.state === 'installed' && !status.onPath) {
    return 'This command directory is not on the OpenWaggle process PATH. Your terminal may differ; run command -v openwaggle there to check.'
  }
  if (status?.detail) return status.detail
  if (status?.state === 'not-installed') {
    return 'The command is not installed. Restart OpenWaggle to retry automatic setup, or reinstall the app.'
  }
  if (status?.state === 'outdated') {
    return 'The command needs an update. Restart OpenWaggle to retry automatic setup.'
  }
  return 'The command is unavailable on this system.'
}

export function CliAvailabilityNotice() {
  const [status, setStatus] = useState<CliShimStatus | null>(null)
  const [readError, setReadError] = useState(false)

  useEffect(() => {
    if (typeof api.getCliShimStatus !== 'function') return
    let cancelled = false
    api.getCliShimStatus().then(
      (result) => {
        if (!cancelled) setStatus(result)
      },
      (error: unknown) => {
        logger.warn('Could not check CLI availability', { error: String(error) })
        if (!cancelled) setReadError(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  if (!readError && status?.state === 'installed' && status.onPath) {
    return null
  }
  if (!readError && !status) {
    return null
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-warning/40 bg-warning/5 px-5 py-3 text-xs text-warning-text"
    >
      <p className="font-medium">OpenWaggle CLI needs attention</p>
      {status?.commandPath ? (
        <p className="mt-1 break-all font-mono">{status.commandPath}</p>
      ) : null}
      <p className="mt-1">
        {readError
          ? 'Could not check CLI availability. The command may not be ready yet.'
          : statusDetail(status)}
      </p>
    </div>
  )
}

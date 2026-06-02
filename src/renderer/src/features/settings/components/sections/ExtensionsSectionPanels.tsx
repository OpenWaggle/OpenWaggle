import { RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export function ExtensionsSectionHeading({
  projectCount,
  loading,
  onRefresh,
}: {
  readonly projectCount: number
  readonly loading: boolean
  readonly onRefresh: () => void
}) {
  const scopeSummary =
    projectCount > 0
      ? `Showing global scope plus ${projectCount} project scope${projectCount === 1 ? '' : 's'}.`
      : 'No projects found; showing global scope only.'

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Extensions</h2>
        <p className="max-w-[760px] text-[13px] leading-5 text-text-tertiary">
          Discovered OpenWaggle extension packages. Trust pins the current package hash; enablement
          is blocked until the package is trusted and valid. Project opt-outs are stored locally.
        </p>
        <p className="text-[11px] text-text-muted">{scopeSummary}</p>
      </div>
      <Button disabled={loading} onClick={onRefresh} leftIcon={<RefreshCw className="size-3" />}>
        Refresh
      </Button>
    </div>
  )
}

export function ExtensionsErrorAlert({ message }: { readonly message: string | null }) {
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

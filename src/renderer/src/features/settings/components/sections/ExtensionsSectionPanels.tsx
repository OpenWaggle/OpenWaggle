import { RefreshCw } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export function ExtensionsSectionHeading({
  projectPath,
  loading,
  onRefresh,
}: {
  readonly projectPath: string | null
  readonly loading: boolean
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Extensions</h2>
        <p className="max-w-[760px] text-[13px] leading-5 text-text-tertiary">
          Discovered OpenWaggle extension packages. Trust pins the current package hash; enablement
          is blocked until the package is trusted and valid.
        </p>
        <p className="text-[11px] text-text-muted">
          {projectPath
            ? `Project scope: ${projectPath}`
            : 'No project selected; showing global scope only.'}
        </p>
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

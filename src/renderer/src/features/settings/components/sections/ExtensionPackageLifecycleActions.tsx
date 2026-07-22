import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionPackageSummary } from '@shared/types/extensions'
import { Button } from '@/shared/ui/Button'
import { packageTitle } from './extension-package-card-model'

export function ReloadAction({
  extensionPackage,
  busy,
  enabled,
  onReload,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly enabled: boolean
  readonly onReload: () => void
}) {
  if (!enabled) {
    return null
  }

  const reloadLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.RELOAD_ACTION_LABEL
  return (
    <Button
      size="xs"
      variant="secondary"
      disabled={busy}
      onClick={onReload}
      aria-label={`${reloadLabel} ${packageTitle(extensionPackage)}`}
    >
      {busy ? 'Saving…' : reloadLabel}
    </Button>
  )
}

export function RemoveAction({
  extensionPackage,
  busy,
  onRemove,
}: {
  readonly extensionPackage: ExtensionPackageSummary
  readonly busy: boolean
  readonly onRemove: () => void
}) {
  return (
    <Button
      size="xs"
      variant="danger"
      disabled={busy}
      onClick={onRemove}
      aria-label={`Remove ${packageTitle(extensionPackage)}`}
      title="Remove the package from disk and tear down extension runtime access."
    >
      {busy ? 'Saving…' : 'Remove'}
    </Button>
  )
}

import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { cn } from '@/shared/lib/cn'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

export function ExtensionContributionRuntimeHost({
  entry,
  autoHeight = false,
  className,
  chrome = 'card',
  fill = false,
  maxAutoHeight,
  minAutoHeight,
  onSurfaceAction,
  surfacePayload,
}: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly autoHeight?: boolean | undefined
  readonly className?: string | undefined
  readonly chrome?: 'bare' | 'card' | undefined
  readonly fill?: boolean | undefined
  readonly maxAutoHeight?: number | undefined
  readonly minAutoHeight?: number | undefined
  readonly onSurfaceAction?: ((actionId: string, payload?: JsonValue) => void) | undefined
  readonly surfacePayload?: JsonValue | undefined
}) {
  const sharedHostProps = {
    autoHeight,
    chrome,
    className,
    entry,
    fill,
    maxAutoHeight,
    minAutoHeight,
    onSurfaceAction,
    surfacePayload,
  }

  if (
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE ||
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER
  ) {
    return <ExtensionFederatedModuleHost {...sharedHostProps} />
  }

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-error/25 bg-error/5 p-3 text-xs text-error',
        className,
      )}
    >
      Unsupported extension runtime.
    </div>
  )
}

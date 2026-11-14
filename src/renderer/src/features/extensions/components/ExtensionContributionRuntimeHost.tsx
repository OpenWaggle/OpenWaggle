import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'
import { ExtensionFederatedModuleHost } from './ExtensionFederatedModuleHost'

export function ExtensionContributionRuntimeHost(
  props: ComponentProps<typeof ExtensionFederatedModuleHost>,
) {
  const { entry, className } = props
  if (
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE ||
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER
  ) {
    return <ExtensionFederatedModuleHost {...props} />
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

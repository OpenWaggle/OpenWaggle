import type { ExtensionInvokeScope } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { invokeBoundExtension } from '@/features/extensions'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('extension-session-summary')

export async function invokeSessionSummaryExtensionCommand(input: {
  readonly entry: ExtensionContributionRegistryEntry & {
    readonly capability: string
    readonly method: string
  }
  readonly scope: ExtensionInvokeScope
  readonly signal: AbortSignal
  readonly showToast: (message: string, tone: 'error') => void
}) {
  try {
    const result = await invokeBoundExtension(input.entry, {
      extensionId: input.entry.extensionId,
      contributionId: input.entry.contributionId,
      capability: input.entry.capability,
      method: input.entry.method,
      scope: input.scope,
      payload: {},
    })
    if (!input.signal.aborted && !result.ok) input.showToast(result.error.message, 'error')
  } catch (error) {
    if (input.signal.aborted) return
    logger.warn('Session Summary extension command failed', { error: String(error) })
    input.showToast('Extension command failed.', 'error')
  }
}

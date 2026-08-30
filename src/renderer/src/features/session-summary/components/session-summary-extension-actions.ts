import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionSessionSummaryRowView,
} from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import { useState } from 'react'
import { resolveExtensionCommandInvocationScope } from '@/features/command-palette'
import { refreshPreferencesAfterExtensionInvoke } from '@/features/extensions'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'

const logger = createRendererLogger('extension-session-summary')

export interface SessionSummaryExtensionSidePanelTarget {
  readonly extensionId: string
  readonly sidePanelId: string
  readonly packagePath: string
  readonly contentHash: string
}

export function isEligibleSessionSummaryEntry(entry: ExtensionContributionRegistryEntry) {
  const eligibility = entry.eligibility
  return (
    eligibility.runtimeEnabled &&
    eligibility.enabled &&
    eligibility.trusted &&
    eligibility.sdkCompatible !== false &&
    !eligibility.updateAvailable
  )
}

export function matchingSessionSummaryAction(input: {
  readonly registry: ExtensionContributionRegistryView
  readonly section: ExtensionContributionRegistryEntry
  readonly row: ExtensionSessionSummaryRowView
}) {
  const action = input.row.action
  if (!action) return null
  return (
    input.registry.entries.find(
      (entry) =>
        entry.extensionId === input.section.extensionId &&
        entry.packagePath === input.section.packagePath &&
        entry.contentHash === input.section.contentHash &&
        entry.family === action.family &&
        entry.contributionId === action.contributionId &&
        isEligibleSessionSummaryEntry(entry),
    ) ?? null
  )
}

export function useSessionSummaryExtensionActions(input: {
  readonly registry: ExtensionContributionRegistryView
  readonly projectPaths: readonly string[]
  readonly sessionId: string
  readonly messageCount: number
  readonly onOpenSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
}) {
  const openResourceViewer = useUIStore((state) => state.openResourceViewer)
  const showToast = useUIStore((state) => state.showToast)
  const [dialogEntry, setDialogEntry] = useState<ExtensionContributionRegistryEntry | null>(null)
  const payload = {
    surface: 'session-summary',
    sessionId: input.sessionId,
    projectPaths: [...input.projectPaths],
    messageCount: input.messageCount,
  } satisfies JsonObject

  async function activateRow(
    section: ExtensionContributionRegistryEntry,
    row: ExtensionSessionSummaryRowView,
  ) {
    if (row.resourceId) {
      openResourceViewer(input.sessionId, row.resourceId)
      return
    }
    const entry = matchingSessionSummaryAction({ registry: input.registry, section, row })
    if (!entry || !row.action) return
    if (row.action.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS) {
      input.onOpenSidePanel?.({
        extensionId: entry.extensionId,
        sidePanelId: entry.contributionId,
        packagePath: entry.packagePath,
        contentHash: entry.contentHash,
      })
      return
    }
    if (row.action.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS) {
      setDialogEntry(entry)
      return
    }
    if (!entry.capability || !entry.method) return
    const scope = resolveExtensionCommandInvocationScope({
      entry,
      projectPath: input.projectPaths[0] ?? null,
      sessionId: input.sessionId,
    })
    if (!scope) return
    try {
      const result = await api.invokeExtension({
        extensionId: entry.extensionId,
        contributionId: entry.contributionId,
        capability: entry.capability,
        method: entry.method,
        scope,
        payload: {},
      })
      if (!result.ok) {
        showToast(result.error.message, 'error')
        return
      }
      await refreshPreferencesAfterExtensionInvoke(result)
    } catch (error) {
      logger.warn('Session Summary extension command failed', { error: String(error) })
      showToast('Extension command failed.', 'error')
    }
  }

  return { activateRow, dialogEntry, setDialogEntry, payload }
}

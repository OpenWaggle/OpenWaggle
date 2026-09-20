import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { ExtensionInvokeScope } from '@shared/types/extension-broker'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionSessionSummaryRowView,
} from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import type { SessionResource } from '@shared/types/session-resource'
import { useEffect, useRef, useState } from 'react'
import { resolveExtensionCommandInvocationScope } from '@/features/command-palette'
import { isInvokableExtensionContributionCommand } from '@/features/composer/commands'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { useUIStore } from '@/shell/ui-store'
import type { SessionResourceBrowserTarget } from '../model/session-resource-browser'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import { invokeSessionSummaryExtensionCommand } from './session-summary-extension-command'

const logger = createRendererLogger('extension-session-summary')

function activateResourceRow(input: {
  readonly resource: SessionResource | undefined
  readonly resourceId: string
  readonly sessionId: string
  readonly openResourceViewer: (sessionId: string, resourceId: string) => void
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
}) {
  if (!input.resource) return
  return match(input.resource)
    .when(
      (resource) => resource !== undefined && isViewableSessionImage(resource),
      () => input.openResourceViewer(input.sessionId, input.resourceId),
    )
    .when(
      (resource) => resource?.kind === 'image' && resource.locator?.startsWith('http') === true,
      (resource) => api.openExternal(resource?.locator ?? ''),
    )
    .otherwise((resource) =>
      input.onOpenResources({
        view: resource.isOutput && !resource.isSource ? 'outputs' : 'sources',
        resourceId: resource.id,
      }),
    )
}

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

type SessionSummaryActionResolution =
  | {
      readonly kind: 'command'
      readonly entry: ExtensionContributionRegistryEntry & {
        readonly capability: string
        readonly method: string
      }
      readonly scope: ExtensionInvokeScope
    }
  | {
      readonly kind: 'disabled-command'
      readonly entry: ExtensionContributionRegistryEntry
      readonly disabledReason: string
    }
  | {
      readonly kind: 'surface'
      readonly entry: ExtensionContributionRegistryEntry
    }

interface SessionSummaryActionOperation {
  readonly controller: AbortController
  readonly sessionId: string
}

export function resolveSessionSummaryAction(input: {
  readonly registry: ExtensionContributionRegistryView
  readonly section: ExtensionContributionRegistryEntry
  readonly row: ExtensionSessionSummaryRowView
  readonly projectPath: string | null
  readonly sessionId: string
}): SessionSummaryActionResolution | null {
  const entry = matchingSessionSummaryAction(input)
  if (!entry || !input.row.action) return null
  if (input.row.action.family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS) {
    return { kind: 'surface', entry }
  }
  if (
    !isInvokableExtensionContributionCommand(
      entry,
      OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
    )
  ) {
    return {
      kind: 'disabled-command',
      entry,
      disabledReason:
        entry.capability && entry.method
          ? 'This extension command is disabled for the current project.'
          : 'This extension command has no executable capability binding.',
    }
  }
  const scope = resolveExtensionCommandInvocationScope({
    entry,
    projectPath: input.projectPath,
    sessionId: input.sessionId,
  })
  return scope
    ? { kind: 'command', entry, scope }
    : {
        kind: 'disabled-command',
        entry,
        disabledReason: 'This extension command is unavailable in the current Session.',
      }
}

async function activateExtensionResourceRow(input: {
  readonly resources: readonly SessionResource[]
  readonly resourceId: string | undefined
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly openResourceViewer: (sessionId: string, resourceId: string) => void
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly showToast: (message: string, tone: 'error') => void
}) {
  if (!input.resourceId || input.signal.aborted) return false
  try {
    const cached = input.resources.find(({ id }) => id === input.resourceId)
    if (cached) {
      if (input.signal.aborted) return true
      await activateResourceRow({
        resource: cached,
        resourceId: input.resourceId,
        sessionId: input.sessionId,
        openResourceViewer: input.openResourceViewer,
        onOpenResources: input.onOpenResources,
      })
      return true
    }
    if (typeof api.getSessionResource !== 'function') return false
    const resource = await api.getSessionResource(
      SessionId(input.sessionId),
      input.resourceId,
      'all',
    )
    if (input.signal.aborted) return true
    if (!resource) return false
    await activateResourceRow({
      resource,
      resourceId: input.resourceId,
      sessionId: input.sessionId,
      openResourceViewer: input.openResourceViewer,
      onOpenResources: input.onOpenResources,
    })
    return true
  } catch (error) {
    if (input.signal.aborted) return true
    logger.warn('Session Summary extension resource action failed', { error: String(error) })
    input.showToast(
      error instanceof Error ? error.message : 'Extension resource action failed.',
      'error',
    )
    return true
  }
}

function activateResolvedExtensionSurface(input: {
  readonly resolution: SessionSummaryActionResolution
  readonly family: string
  readonly onOpenSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly setDialogEntry: (entry: ExtensionContributionRegistryEntry) => void
}) {
  const { entry } = input.resolution
  if (input.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS) {
    input.onOpenSidePanel?.({
      extensionId: entry.extensionId,
      sidePanelId: entry.contributionId,
      packagePath: entry.packagePath,
      contentHash: entry.contentHash,
    })
    return true
  }
  if (input.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS) {
    input.setDialogEntry(entry)
    return true
  }
  return false
}

export function useSessionSummaryExtensionActions(input: {
  readonly registry: ExtensionContributionRegistryView
  readonly projectPaths: readonly string[]
  readonly sessionId: string
  readonly messageCount: number
  readonly resources: readonly SessionResource[]
  readonly onOpenResources: (target: SessionResourceBrowserTarget) => void
  readonly onOpenSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
}) {
  const openResourceViewer = useUIStore((state) => state.openResourceViewer)
  const showToast = useUIStore((state) => state.showToast)
  const [dialogEntry, setDialogEntry] = useState<ExtensionContributionRegistryEntry | null>(null)
  const activeOperation = useRef<SessionSummaryActionOperation | null>(null)
  useEffect(() => {
    const owningSessionId = input.sessionId
    return () => {
      const operation = activeOperation.current
      if (!operation || operation.sessionId !== owningSessionId) return
      operation.controller.abort()
      activeOperation.current = null
    }
  }, [input.sessionId])
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
    activeOperation.current?.controller.abort()
    const controller = new AbortController()
    activeOperation.current = { controller, sessionId: input.sessionId }
    if (row.resourceId) {
      const resourceHandled = await activateExtensionResourceRow({
        resources: input.resources,
        resourceId: row.resourceId,
        sessionId: input.sessionId,
        signal: controller.signal,
        openResourceViewer,
        onOpenResources: input.onOpenResources,
        showToast,
      })
      if (controller.signal.aborted) return
      if (resourceHandled) return
    }
    const resolution = resolveSessionSummaryAction({
      registry: input.registry,
      section,
      row,
      projectPath: input.projectPaths[0] ?? null,
      sessionId: input.sessionId,
    })
    if (!resolution || resolution.kind === 'disabled-command' || !row.action) return
    if (
      activateResolvedExtensionSurface({
        resolution,
        family: row.action.family,
        onOpenSidePanel: input.onOpenSidePanel,
        setDialogEntry,
      })
    )
      return
    if (resolution.kind !== 'command') return
    await invokeSessionSummaryExtensionCommand({
      entry: resolution.entry,
      scope: resolution.scope,
      signal: controller.signal,
      showToast,
    })
  }

  return { activateRow, dialogEntry, setDialogEntry, payload }
}

import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { useRef, useState } from 'react'
import {
  type ComposerExtensionActionLauncher,
  ComposerExtensionActions,
} from '@/features/composer/components'
import {
  agentLoopAuxiliarySurfacePayload,
  agentLoopInputKey,
  type ExtensionAgentLoopSurfaceInput,
  ExtensionDialogSurfaceContent,
  type ExtensionDialogTarget,
  ExtensionSidePanelSurfaceContent,
  type ExtensionSidePanelTarget,
  resolveExtensionAgentLoopContributionEntries,
  surfaceLabel,
  surfaceTarget,
} from '@/features/extensions'
import { responseFromExtensionAction } from '../lib/agent-loop-interaction-response-actions'
import { toExtensionInteractionView } from '../lib/agent-loop-interaction-view'

type InteractionSurfaceInput = Extract<
  ExtensionAgentLoopSurfaceInput,
  { readonly surface: 'interaction' }
>

interface PendingInteractionDialogInput {
  readonly interaction: AgentLoopInteraction
  readonly surfaceInput: InteractionSurfaceInput
}

interface ActiveComposerExtensionDialog {
  readonly kind: 'dialog'
  readonly interaction: AgentLoopInteraction
  readonly target: ExtensionDialogTarget
  readonly surfacePayload: JsonObject
}

interface ActiveComposerExtensionSidePanel {
  readonly kind: 'side-panel'
  readonly interaction: AgentLoopInteraction
  readonly target: ExtensionSidePanelTarget
  readonly surfacePayload: JsonObject
}

type ActiveComposerExtensionSurface =
  | ActiveComposerExtensionDialog
  | ActiveComposerExtensionSidePanel

interface ChatComposerExtensionDialogsProps {
  readonly agentInteractions: readonly AgentLoopInteraction[]
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly onRespond: (
    interaction: AgentLoopInteraction,
    response: AgentLoopInteractionResponse,
  ) => Promise<void>
}

function noOp() {}

function pendingInteractionInputs(
  interactions: readonly AgentLoopInteraction[],
): readonly PendingInteractionDialogInput[] {
  return interactions.map((interaction) => ({
    interaction,
    surfaceInput: {
      surface: 'interaction',
      interaction: toExtensionInteractionView(interaction),
    },
  }))
}

function buildExtensionDialogLaunchers({
  registry,
  projectPaths,
  inputs,
  onOpenSurface,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly inputs: readonly PendingInteractionDialogInput[]
  readonly onOpenSurface: (surface: ActiveComposerExtensionSurface) => void
}): readonly ComposerExtensionActionLauncher[] {
  if (registry === null) {
    return []
  }

  const launchers: ComposerExtensionActionLauncher[] = []

  for (const { interaction, surfaceInput } of inputs) {
    const target = surfaceTarget(surfaceInput)
    const dialogContributions = resolveExtensionAgentLoopContributionEntries({
      registry,
      target,
      requestedProjectPaths: projectPaths,
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
    })
    const sidePanelContributions = resolveExtensionAgentLoopContributionEntries({
      registry,
      target,
      requestedProjectPaths: projectPaths,
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    })

    for (const contribution of dialogContributions) {
      const entry = contribution.entry
      const dialogTarget: ExtensionDialogTarget = {
        extensionId: entry.extensionId,
        dialogId: entry.contributionId,
        packagePath: entry.packagePath,
        contentHash: entry.contentHash,
      }

      launchers.push({
        id: `extension-dialog:${entry.packagePath}:${entry.contentHash}:${entry.contributionId}:${agentLoopInputKey(surfaceInput)}`,
        title: entry.title,
        description: `${surfaceLabel(surfaceInput)} from ${entry.extensionName}`,
        badge: 'Dialog',
        onOpen: () =>
          onOpenSurface({
            kind: 'dialog',
            interaction,
            target: dialogTarget,
            surfacePayload: agentLoopAuxiliarySurfacePayload(surfaceInput, 'dialog'),
          }),
      })
    }

    for (const contribution of sidePanelContributions) {
      const entry = contribution.entry
      const sidePanelTarget: ExtensionSidePanelTarget = {
        extensionId: entry.extensionId,
        sidePanelId: entry.contributionId,
        packagePath: entry.packagePath,
        contentHash: entry.contentHash,
      }

      launchers.push({
        id: `extension-side-panel:${entry.packagePath}:${entry.contentHash}:${entry.contributionId}:${agentLoopInputKey(surfaceInput)}`,
        title: entry.title,
        description: `${surfaceLabel(surfaceInput)} from ${entry.extensionName}`,
        badge: 'Side panel',
        onOpen: () =>
          onOpenSurface({
            kind: 'side-panel',
            interaction,
            target: sidePanelTarget,
            surfacePayload: agentLoopAuxiliarySurfacePayload(surfaceInput, 'side-panel'),
          }),
      })
    }
  }

  return launchers
}

function ActiveComposerSidePanelSurface({
  activeSurface,
  extensionProjectPaths,
  extensionRegistry,
  onClose,
  onSurfaceAction,
}: {
  readonly activeSurface: ActiveComposerExtensionSidePanel
  readonly extensionProjectPaths: readonly string[]
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly onClose: () => void
  readonly onSurfaceAction: (actionId: string, payload?: JsonValue) => void
}) {
  const surfaceProps = {
    error: null,
    loading: false,
    onClose,
    onRefresh: noOp,
    onSurfaceAction,
    projectPaths: extensionProjectPaths,
    registry: extensionRegistry,
    surfacePayload: activeSurface.surfacePayload,
    target: activeSurface.target,
  }

  return (
    <div className="fixed inset-y-4 right-4 z-50 w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border bg-diff-bg shadow-2xl">
      <ExtensionSidePanelSurfaceContent {...surfaceProps} />
    </div>
  )
}

export function ChatComposerExtensionDialogs({
  agentInteractions,
  extensionRegistry,
  extensionProjectPaths,
  onRespond,
}: ChatComposerExtensionDialogsProps) {
  const [activeSurface, setActiveSurface] = useState<ActiveComposerExtensionSurface | null>(null)
  const busyInteractionIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function openSurface(surface: ActiveComposerExtensionSurface) {
    setError(null)
    setActiveSurface(surface)
  }

  function handleSurfaceAction(actionId: string, payload?: JsonValue) {
    if (activeSurface === null || busyInteractionIdRef.current !== null) {
      return
    }

    const response = responseFromExtensionAction({
      interaction: activeSurface.interaction,
      actionId,
      payload,
    })
    if (response === null) {
      return
    }

    const surface = activeSurface
    setError(null)
    busyInteractionIdRef.current = surface.interaction.interactionId
    onRespond(surface.interaction, response)
      .then(() => {
        setActiveSurface((current) => (current === surface ? null : current))
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        busyInteractionIdRef.current = null
      })
  }

  const launchers = buildExtensionDialogLaunchers({
    registry: extensionRegistry,
    projectPaths: extensionProjectPaths,
    inputs: pendingInteractionInputs(agentInteractions),
    onOpenSurface: openSurface,
  })

  return (
    <>
      <ComposerExtensionActions launchers={launchers} />
      {error ? <p className="mb-2 text-[12px] text-error">{error}</p> : null}
      {activeSurface?.kind === 'dialog' ? (
        <ExtensionDialogSurfaceContent
          actions={{
            onClose: () => setActiveSurface(null),
            onRefresh: noOp,
            onSurfaceAction: handleSurfaceAction,
          }}
          error={null}
          loading={false}
          projectPaths={extensionProjectPaths}
          registry={extensionRegistry}
          surfacePayload={activeSurface.surfacePayload}
          target={activeSurface.target}
        />
      ) : null}
      {activeSurface?.kind === 'side-panel' ? (
        <ActiveComposerSidePanelSurface
          activeSurface={activeSurface}
          extensionProjectPaths={extensionProjectPaths}
          extensionRegistry={extensionRegistry}
          onClose={() => setActiveSurface(null)}
          onSurfaceAction={handleSurfaceAction}
        />
      ) : null}
    </>
  )
}

import { matchBy } from '@diegogbrisa/ts-match'
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
  type ExtensionAgentLoopSurfaceInput,
  ExtensionDialogSurfaceContent,
  type ExtensionDialogTarget,
  resolveExtensionAgentLoopContributionEntries,
  surfaceLabel,
  surfacePayload,
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
  readonly interaction: AgentLoopInteraction
  readonly target: ExtensionDialogTarget
  readonly surfacePayload: JsonObject
}

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

function agentLoopInputKey(input: ExtensionAgentLoopSurfaceInput) {
  return matchBy(input, 'surface')
    .with('tool', (value) => `tool:${value.toolCall.id}`)
    .with('custom-message', (value) => `custom-message:${value.message.name}`)
    .with('interaction', (value) => `interaction:${value.interaction.id}`)
    .with(
      'transcript',
      (value) =>
        `transcript:${value.transcript.sessionId ?? 'none'}:${String(value.transcript.messageCount)}`,
    )
    .with('status', (value) => `status:${value.status.label}`)
    .exhaustive()
}

function composerDialogPayload(input: ExtensionAgentLoopSurfaceInput): JsonObject {
  return {
    surface: 'composer-adjacent',
    launcher: {
      kind: 'dialog',
    },
    agentLoop: surfacePayload(input),
  }
}

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
  onOpenDialog,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly inputs: readonly PendingInteractionDialogInput[]
  readonly onOpenDialog: (dialog: ActiveComposerExtensionDialog) => void
}): readonly ComposerExtensionActionLauncher[] {
  if (registry === null) {
    return []
  }

  const launchers: ComposerExtensionActionLauncher[] = []

  for (const { interaction, surfaceInput } of inputs) {
    const target = surfaceTarget(surfaceInput)
    const contributions = resolveExtensionAgentLoopContributionEntries({
      registry,
      target,
      requestedProjectPaths: projectPaths,
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
    })

    for (const contribution of contributions) {
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
          onOpenDialog({
            interaction,
            target: dialogTarget,
            surfacePayload: composerDialogPayload(surfaceInput),
          }),
      })
    }
  }

  return launchers
}

export function ChatComposerExtensionDialogs({
  agentInteractions,
  extensionRegistry,
  extensionProjectPaths,
  onRespond,
}: ChatComposerExtensionDialogsProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveComposerExtensionDialog | null>(null)
  const busyInteractionIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function openDialog(dialog: ActiveComposerExtensionDialog) {
    setError(null)
    setActiveDialog(dialog)
  }

  function handleSurfaceAction(actionId: string, payload?: JsonValue) {
    if (activeDialog === null || busyInteractionIdRef.current !== null) {
      return
    }

    const response = responseFromExtensionAction({
      interaction: activeDialog.interaction,
      actionId,
      payload,
    })
    if (response === null) {
      return
    }

    const dialog = activeDialog
    setError(null)
    busyInteractionIdRef.current = dialog.interaction.interactionId
    onRespond(dialog.interaction, response)
      .then(() => {
        setActiveDialog((current) => (current === dialog ? null : current))
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
    onOpenDialog: openDialog,
  })

  return (
    <>
      <ComposerExtensionActions launchers={launchers} />
      {error ? <p className="mb-2 text-[12px] text-error">{error}</p> : null}
      {activeDialog ? (
        <ExtensionDialogSurfaceContent
          actions={{
            onClose: () => setActiveDialog(null),
            onRefresh: noOp,
            onSurfaceAction: handleSurfaceAction,
          }}
          error={null}
          loading={false}
          projectPaths={extensionProjectPaths}
          registry={extensionRegistry}
          surfacePayload={activeDialog.surfacePayload}
          target={activeDialog.target}
        />
      ) : null}
    </>
  )
}

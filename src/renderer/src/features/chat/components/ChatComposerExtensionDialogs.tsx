import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import { useState } from 'react'
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
import { toExtensionInteractionView } from '../lib/agent-loop-interaction-view'

interface ActiveComposerExtensionDialog {
  readonly target: ExtensionDialogTarget
  readonly surfacePayload: JsonObject
}

interface ChatComposerExtensionDialogsProps {
  readonly agentInteractions: readonly AgentLoopInteraction[]
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
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
): readonly ExtensionAgentLoopSurfaceInput[] {
  return interactions.map((interaction) => ({
    surface: 'interaction',
    interaction: toExtensionInteractionView(interaction),
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
  readonly inputs: readonly ExtensionAgentLoopSurfaceInput[]
  readonly onOpenDialog: (dialog: ActiveComposerExtensionDialog) => void
}): readonly ComposerExtensionActionLauncher[] {
  if (registry === null) {
    return []
  }

  const launchers: ComposerExtensionActionLauncher[] = []

  for (const input of inputs) {
    const target = surfaceTarget(input)
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
        id: `extension-dialog:${entry.packagePath}:${entry.contentHash}:${entry.contributionId}:${agentLoopInputKey(input)}`,
        title: entry.title,
        description: `${surfaceLabel(input)} from ${entry.extensionName}`,
        badge: 'Dialog',
        onOpen: () =>
          onOpenDialog({
            target: dialogTarget,
            surfacePayload: composerDialogPayload(input),
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
}: ChatComposerExtensionDialogsProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveComposerExtensionDialog | null>(null)
  const launchers = buildExtensionDialogLaunchers({
    registry: extensionRegistry,
    projectPaths: extensionProjectPaths,
    inputs: pendingInteractionInputs(agentInteractions),
    onOpenDialog: setActiveDialog,
  })

  return (
    <>
      <ComposerExtensionActions launchers={launchers} />
      {activeDialog ? (
        <ExtensionDialogSurfaceContent
          error={null}
          loading={false}
          onClose={() => setActiveDialog(null)}
          onRefresh={noOp}
          projectPaths={extensionProjectPaths}
          registry={extensionRegistry}
          surfacePayload={activeDialog.surfacePayload}
          target={activeDialog.target}
        />
      ) : null}
    </>
  )
}

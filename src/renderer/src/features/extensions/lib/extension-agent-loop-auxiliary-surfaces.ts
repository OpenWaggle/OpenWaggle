import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionFamily,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import type { JsonObject } from '@shared/types/json'
import {
  type ResolvedExtensionAgentLoopContribution,
  resolveExtensionAgentLoopContributionEntries,
} from './extension-agent-loop-resolution'
import type {
  ExtensionAgentLoopSurfaceInput,
  ExtensionInteractionView,
} from './extension-agent-loop-surface-model'
import { surfacePayload, surfaceTarget } from './extension-agent-loop-surface-model'

export type ExtensionAgentLoopAuxiliaryPlacement = 'dialog' | 'side-panel' | 'status-widget'

export interface ExtensionAgentLoopAuxiliaryContribution {
  readonly placement: ExtensionAgentLoopAuxiliaryPlacement
  readonly contribution: ResolvedExtensionAgentLoopContribution
  readonly surfacePayload: JsonObject
}

const AUXILIARY_PLACEMENT_FAMILY = {
  dialog: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
  'side-panel': OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
  'status-widget': OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
} satisfies Record<ExtensionAgentLoopAuxiliaryPlacement, ExtensionContributionFamily>

function auxiliaryLauncherKind(placement: ExtensionAgentLoopAuxiliaryPlacement) {
  return placement
}

export function agentLoopInputKey(input: ExtensionAgentLoopSurfaceInput) {
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

export function agentLoopAuxiliarySurfacePayload(
  input: ExtensionAgentLoopSurfaceInput,
  placement: ExtensionAgentLoopAuxiliaryPlacement,
): JsonObject {
  return {
    surface: placement === 'status-widget' ? 'status-widget' : 'composer-adjacent',
    launcher: {
      kind: auxiliaryLauncherKind(placement),
    },
    agentLoop: surfacePayload(input),
  }
}

export function resolveExtensionAgentLoopAuxiliaryContributions({
  input,
  registry,
  projectPaths,
  placement,
}: {
  readonly input: ExtensionAgentLoopSurfaceInput
  readonly registry: ExtensionContributionRegistryView | null
  readonly projectPaths: readonly string[]
  readonly placement: ExtensionAgentLoopAuxiliaryPlacement
}): readonly ExtensionAgentLoopAuxiliaryContribution[] {
  if (registry === null) {
    return []
  }

  const family = AUXILIARY_PLACEMENT_FAMILY[placement]
  return resolveExtensionAgentLoopContributionEntries({
    registry,
    target: surfaceTarget(input),
    requestedProjectPaths: projectPaths,
    family,
  }).map((contribution) => ({
    placement,
    contribution,
    surfacePayload: agentLoopAuxiliarySurfacePayload(input, placement),
  }))
}

export function interactionSurfaceInput(
  interaction: ExtensionInteractionView,
): Extract<ExtensionAgentLoopSurfaceInput, { readonly surface: 'interaction' }> {
  return {
    surface: 'interaction',
    interaction,
  }
}

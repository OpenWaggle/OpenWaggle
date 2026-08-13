import { matchBy } from '@diegogbrisa/ts-match';
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { resolveExtensionAgentLoopContributionEntries, } from './extension-agent-loop-resolution';
import { surfacePayload, surfaceTarget } from './extension-agent-loop-surface-model';
const AUXILIARY_PLACEMENT_FAMILY = {
    dialog: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
    'side-panel': OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
    'status-widget': OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
};
function auxiliaryLauncherKind(placement) {
    return placement;
}
export function agentLoopInputKey(input) {
    return matchBy(input, 'surface')
        .with('tool', (value) => `tool:${value.toolCall.id}`)
        .with('custom-message', (value) => `custom-message:${value.message.name}`)
        .with('interaction', (value) => `interaction:${value.interaction.id}`)
        .with('transcript', (value) => `transcript:${value.transcript.sessionId ?? 'none'}:${String(value.transcript.messageCount)}`)
        .with('status', (value) => `status:${value.status.label}`)
        .exhaustive();
}
export function agentLoopAuxiliarySurfacePayload(input, placement) {
    return {
        surface: placement === 'status-widget' ? 'status-widget' : 'composer-adjacent',
        launcher: {
            kind: auxiliaryLauncherKind(placement),
        },
        agentLoop: surfacePayload(input),
    };
}
export function resolveExtensionAgentLoopAuxiliaryContributions({ input, registry, projectPaths, placement, }) {
    if (registry === null) {
        return [];
    }
    const family = AUXILIARY_PLACEMENT_FAMILY[placement];
    return resolveExtensionAgentLoopContributionEntries({
        registry,
        target: surfaceTarget(input),
        requestedProjectPaths: projectPaths,
        family,
    }).map((contribution) => ({
        placement,
        contribution,
        surfacePayload: agentLoopAuxiliarySurfacePayload(input, placement),
    }));
}
export function interactionSurfaceInput(interaction) {
    return {
        surface: 'interaction',
        interaction,
    };
}

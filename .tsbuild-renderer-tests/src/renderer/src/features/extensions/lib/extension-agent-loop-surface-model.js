import { matchBy } from '@diegogbrisa/ts-match';
import { EXTENSION_FRAME_SURFACE_ACTION } from '@shared/constants/extension-frame';
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
export const CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID = 'custom-renderer-unavailable';
export const CUSTOM_INTERACTION_RESPONSE_ACTION_ID = EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE;
function textPayload(value) {
    return value;
}
export function surfaceTarget(input) {
    return matchBy(input, 'surface')
        .with('tool', (value) => ({ surface: 'tool', toolName: value.toolCall.name }))
        .with('custom-message', (value) => ({
        surface: 'custom-message',
        customMessageName: value.message.name,
    }))
        .with('interaction', (value) => ({
        surface: 'interaction',
        interactionKind: value.interaction.customType,
    }))
        .with('transcript', () => ({ surface: 'transcript' }))
        .with('status', () => ({ surface: 'status' }))
        .exhaustive();
}
export function surfacePayload(input) {
    if (input.surface === 'tool') {
        return {
            surface: 'tool',
            toolCall: {
                id: input.toolCall.id,
                name: input.toolCall.name,
                arguments: input.toolCall.arguments,
                state: input.toolCall.state,
            },
            ...(input.toolResult !== undefined
                ? {
                    toolResult: {
                        content: textPayload(input.toolResult.content),
                        state: input.toolResult.state,
                        ...(input.toolResult.error !== undefined ? { error: input.toolResult.error } : {}),
                    },
                }
                : {}),
        };
    }
    if (input.surface === 'custom-message') {
        return {
            surface: 'custom-message',
            message: {
                name: input.message.name,
                value: input.message.value,
            },
        };
    }
    if (input.surface === 'interaction') {
        return {
            surface: 'interaction',
            interaction: {
                id: input.interaction.id,
                kind: input.interaction.kind,
                customType: input.interaction.customType,
                title: input.interaction.title,
                ...(input.interaction.payload !== undefined ? { payload: input.interaction.payload } : {}),
                ...(input.interaction.description !== undefined
                    ? { description: input.interaction.description }
                    : {}),
                state: input.interaction.state,
                actions: input.interaction.actions.map((action) => ({
                    id: action.id,
                    label: action.label,
                    ...(action.tone !== undefined ? { tone: action.tone } : {}),
                })),
            },
        };
    }
    if (input.surface === 'transcript') {
        return {
            surface: 'transcript',
            transcript: {
                sessionId: input.transcript.sessionId,
                projectPaths: [...input.transcript.projectPaths],
                messageCount: input.transcript.messageCount,
                state: input.transcript.state,
            },
        };
    }
    return {
        surface: 'status',
        status: {
            label: input.status.label,
            ...(input.status.detail !== undefined ? { detail: input.status.detail } : {}),
            tone: input.status.tone,
        },
    };
}
export function surfaceLabel(input) {
    return matchBy(input, 'surface')
        .with('tool', (value) => `Tool output · ${value.toolCall.name}`)
        .with('custom-message', (value) => `Custom message · ${value.message.name}`)
        .with('interaction', (value) => `Interaction · ${value.interaction.customType}`)
        .with('transcript', () => 'Transcript summary')
        .with('status', () => 'Run status')
        .exhaustive();
}
export function surfaceFamily(input) {
    return matchBy(input, 'surface')
        .with('tool', () => OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS)
        .with('custom-message', () => OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS)
        .with('interaction', () => OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS)
        .with('transcript', () => OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS)
        .with('status', () => OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS)
        .exhaustive();
}

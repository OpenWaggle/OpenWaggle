import { buildChatRows } from './useBuildChatRows';
export function useChatRows(inputs) {
    return buildChatRows({
        messages: inputs.messages,
        customMessages: inputs.customMessages ?? [],
        interactionEvents: inputs.interactionEvents ?? [],
        isLoading: inputs.isLoading,
        error: inputs.error,
        lastUserMessage: inputs.lastUserMessage,
        dismissedError: inputs.dismissedError,
        sessionId: inputs.sessionId,
        waggleMetadataLookup: inputs.waggleMetadataLookup,
        phase: inputs.phase,
        interruptedRun: inputs.interruptedRun,
    });
}

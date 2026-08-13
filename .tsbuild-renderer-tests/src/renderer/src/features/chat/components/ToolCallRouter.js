import { jsx as _jsx } from "react/jsx-runtime";
import { ExtensionAgentLoopSurface } from '@/features/extensions';
import { ToolCallBlock } from './ToolCallBlock';
const JSON_STRINGIFY_INDENT = 2;
const EMPTY_PROJECT_PATHS = [];
function stringifyToolResultContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    try {
        return JSON.stringify(content, null, JSON_STRINGIFY_INDENT);
    }
    catch {
        return String(content);
    }
}
export function ToolCallRouter({ part, toolResults, sessionId: _sessionId, isStreaming, extensionRegistry = null, extensionProjectPaths = EMPTY_PROJECT_PATHS, onBranchFromMessage, }) {
    const finalResult = toolResults.get(part.id);
    const visibleResult = finalResult ??
        (part.partialOutput === undefined
            ? undefined
            : { content: part.partialOutput, state: 'partial' });
    const toolCallBlock = (_jsx(ToolCallBlock, { name: part.name, args: part.arguments, state: part.state, result: visibleResult, isStreaming: isStreaming, onBranchFromMessage: onBranchFromMessage }));
    if (extensionRegistry !== null) {
        return (_jsx(ExtensionAgentLoopSurface, { input: {
                surface: 'tool',
                toolCall: part,
                ...(visibleResult !== undefined
                    ? {
                        toolResult: {
                            content: stringifyToolResultContent(visibleResult.content),
                            state: visibleResult.state,
                            ...(visibleResult.error !== undefined ? { error: visibleResult.error } : {}),
                        },
                    }
                    : {}),
            }, fallback: toolCallBlock, projectPaths: extensionProjectPaths, registry: extensionRegistry }));
    }
    return toolCallBlock;
}

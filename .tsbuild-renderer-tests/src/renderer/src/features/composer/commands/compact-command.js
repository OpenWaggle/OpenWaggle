import { BUILT_IN_COMPOSER_SLASH_COMMAND } from './built-in-slash-commands';
const COMPACT_COMMAND = BUILT_IN_COMPOSER_SLASH_COMMAND.COMPACT;
export function parseCompactCommand(text) {
    const trimmed = text.trim();
    if (trimmed === COMPACT_COMMAND) {
        return {};
    }
    if (!trimmed.startsWith(`${COMPACT_COMMAND} `)) {
        return null;
    }
    const customInstructions = trimmed.slice(COMPACT_COMMAND.length).trim();
    return customInstructions ? { customInstructions } : {};
}
export function compactCommandText(customInstructions) {
    const trimmed = customInstructions?.trim();
    return trimmed ? `${COMPACT_COMMAND} ${trimmed}` : COMPACT_COMMAND;
}

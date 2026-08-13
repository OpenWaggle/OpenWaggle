import { THINKING_LEVEL_LABELS } from '../constants/thinking-level-labels';
export function hasOnlyOffThinkingLevel(levels) {
    return levels.length === 1 && levels[0] === 'off';
}
export function getThinkingButtonLabel(hasSelectedModel, capabilitiesKnown, effectiveThinkingLevel) {
    return hasSelectedModel && capabilitiesKnown
        ? THINKING_LEVEL_LABELS[effectiveThinkingLevel]
        : 'Thinking…';
}
export function getThinkingButtonTitle({ hasSelectedModel, capabilitiesKnown, selectedModelOnlySupportsOff, isAdjustedForModel, requestedThinkingLevel, effectiveThinkingLevel, }) {
    if (!hasSelectedModel)
        return 'Select a model before choosing thinking level';
    if (!capabilitiesKnown)
        return 'Loading thinking capabilities for the selected model';
    if (selectedModelOnlySupportsOff)
        return 'Selected model does not support thinking';
    if (isAdjustedForModel) {
        return `${THINKING_LEVEL_LABELS[requestedThinkingLevel]} is not available for this model; using ${THINKING_LEVEL_LABELS[effectiveThinkingLevel]}`;
    }
    return 'Select thinking level';
}

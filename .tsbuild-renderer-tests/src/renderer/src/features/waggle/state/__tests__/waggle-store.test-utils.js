import { SupportedModelId } from '@shared/types/brand';
export const ARCHITECT_MODEL = SupportedModelId('claude-sonnet-4-20250514');
export const REVIEWER_MODEL = SupportedModelId('gpt-4o');
export function itemAt(items, index) {
    const item = items[index];
    if (!item) {
        throw new Error(`Expected item at index ${String(index)}`);
    }
    return item;
}
export function makeConfig() {
    return {
        mode: 'sequential',
        agents: [
            {
                label: 'Architect',
                model: ARCHITECT_MODEL,
                roleDescription: 'System designer',
                color: 'blue',
            },
            {
                label: 'Reviewer',
                model: REVIEWER_MODEL,
                roleDescription: 'Code reviewer',
                color: 'amber',
            },
        ],
        stop: { primary: 'consensus', maxTurnsSafety: 10 },
    };
}
export function makeConsensusResult(reached) {
    return {
        reached,
        confidence: reached ? 0.85 : 0.3,
        reason: reached ? 'Agents agree on the approach' : 'Still debating',
        signals: [
            { type: 'explicit-agreement', confidence: 0.9, reason: 'Both agents confirmed approach' },
        ],
    };
}
export function makeFileConflict(path) {
    return {
        path,
        previousAgent: 'Architect',
        currentAgent: 'Reviewer',
        turnNumber: 2,
    };
}
export function makeMessageMetadata(overrides = {}) {
    return {
        agentIndex: 0,
        agentLabel: 'Architect',
        agentColor: 'blue',
        turnNumber: 1,
        ...overrides,
    };
}

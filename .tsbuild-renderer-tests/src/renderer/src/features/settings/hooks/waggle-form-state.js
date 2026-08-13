import { matchBy } from '@diegogbrisa/ts-match';
import { DOUBLE_FACTOR } from '@shared/constants/math';
import { WAGGLE_INHERIT_MODEL, } from '@shared/types/waggle';
const MAX_TURNS = 8;
export const INITIAL_WAGGLE_FORM_STATE = {
    agents: [
        {
            label: 'Agent A',
            model: WAGGLE_INHERIT_MODEL,
            roleDescription: '',
            color: 'blue',
        },
        {
            label: 'Agent B',
            model: WAGGLE_INHERIT_MODEL,
            roleDescription: '',
            color: 'amber',
        },
    ],
    mode: 'sequential',
    stopCondition: 'consensus',
    maxTurns: MAX_TURNS,
};
export const INITIAL_WAGGLE_PRESET_STATE = {
    activePresetId: null,
    error: null,
};
export function configMatchesPreset(config, preset) {
    const pc = preset.config;
    if (config.mode !== pc.mode)
        return false;
    if (config.stop.primary !== pc.stop.primary)
        return false;
    if (config.stop.maxTurnsSafety !== pc.stop.maxTurnsSafety)
        return false;
    for (let i = 0; i < DOUBLE_FACTOR; i++) {
        const a = config.agents[i];
        const p = pc.agents[i];
        if (!a || !p)
            return false;
        if (a.label !== p.label)
            return false;
        if (a.model !== p.model)
            return false;
        if (a.roleDescription !== p.roleDescription)
            return false;
        if (a.color !== p.color)
            return false;
    }
    return true;
}
export function buildWaggleConfig(state) {
    const [agentA, agentB] = state.agents;
    return {
        mode: state.mode,
        agents: [agentA, agentB],
        stop: { primary: state.stopCondition, maxTurnsSafety: state.maxTurns },
    };
}
function updateAgentAt(agents, index, update) {
    if (index === 0) {
        return [update(agents[0]), agents[1]];
    }
    return [agents[0], update(agents[1])];
}
export function waggleFormReducer(state, action) {
    return matchBy(action, 'type')
        .with('load-preset', (value) => ({
        agents: value.config.agents,
        mode: value.config.mode,
        stopCondition: value.config.stop.primary,
        maxTurns: value.config.stop.maxTurnsSafety,
    }))
        .with('set-agent-label', (value) => ({
        ...state,
        agents: updateAgentAt(state.agents, value.index, (agent) => ({
            ...agent,
            label: value.label,
        })),
    }))
        .with('set-agent-model', (value) => ({
        ...state,
        agents: updateAgentAt(state.agents, value.index, (agent) => ({
            ...agent,
            model: value.model,
        })),
    }))
        .with('set-agent-role', (value) => ({
        ...state,
        agents: updateAgentAt(state.agents, value.index, (agent) => ({
            ...agent,
            roleDescription: value.roleDescription,
        })),
    }))
        .with('set-agent-color', (value) => ({
        ...state,
        agents: updateAgentAt(state.agents, value.index, (agent) => ({
            ...agent,
            color: value.color,
        })),
    }))
        .with('set-stop-condition', (value) => ({ ...state, stopCondition: value.stopCondition }))
        .with('set-max-turns', (value) => ({ ...state, maxTurns: value.maxTurns }))
        .exhaustive();
}
export function wagglePresetReducer(state, action) {
    return matchBy(action, 'type')
        .with('select-preset', (value) => ({ ...state, activePresetId: value.activePresetId }))
        .with('save-success', (value) => ({
        ...state,
        activePresetId: value.activePresetId,
        error: null,
    }))
        .with('clear-active-preset', () => ({ ...state, activePresetId: null }))
        .with('clear-error', () => ({ ...state, error: null }))
        .with('set-error', (value) => ({ ...state, error: value.error }))
        .exhaustive();
}

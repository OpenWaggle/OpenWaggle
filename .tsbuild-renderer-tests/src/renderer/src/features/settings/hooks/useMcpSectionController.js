import { matchBy } from '@diegogbrisa/ts-match';
import { useEffect, useReducer } from 'react';
import { api } from '@/shared/lib/ipc';
import { useUIStore } from '@/shell/ui-store';
const INITIAL_SELECTED_SOURCE_ID = 'global-standard';
const MCP_SECTION_INITIAL_STATE = {
    view: null,
    selectedSourceId: INITIAL_SELECTED_SOURCE_ID,
    rawEdits: {},
    loadState: 'idle',
    error: null,
};
function withoutRawEdit(rawEdits, sourceId) {
    const remainingEdits = { ...rawEdits };
    delete remainingEdits[sourceId];
    return remainingEdits;
}
function mcpSectionReducer(state, action) {
    return matchBy(action, 'type')
        .with('load:start', () => ({ ...state, loadState: 'loading', error: null }))
        .with('load:success', (value) => ({
        ...state,
        view: value.view,
        rawEdits: {},
        loadState: 'idle',
        error: null,
    }))
        .with('load:error', (value) => ({ ...state, loadState: 'idle', error: value.error }))
        .with('save:start', () => ({ ...state, loadState: 'saving', error: null }))
        .with('mutation:success', (value) => ({
        ...state,
        view: value.view,
        loadState: 'idle',
        error: null,
    }))
        .with('source-save:success', (value) => ({
        ...state,
        view: value.view,
        rawEdits: withoutRawEdit(state.rawEdits, value.sourceId),
        loadState: 'idle',
        error: null,
    }))
        .with('mutation:error', (value) => ({ ...state, loadState: 'idle', error: value.error }))
        .with('source:select', (value) => ({ ...state, selectedSourceId: value.sourceId }))
        .with('raw-edit:change', (value) => ({
        ...state,
        rawEdits: { ...state.rawEdits, [value.sourceId]: value.rawJson },
    }))
        .exhaustive();
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function sourceById(sources, sourceId) {
    return sources.find((source) => source.id === sourceId) ?? null;
}
function getSelectedSource(view, selectedSourceId) {
    return sourceById(view.sources, selectedSourceId) ?? view.sources[0] ?? null;
}
export function useMcpSectionController(projectPath) {
    const [state, dispatch] = useReducer(mcpSectionReducer, MCP_SECTION_INITIAL_STATE);
    const showToast = useUIStore((state) => state.showToast);
    const { view, selectedSourceId, rawEdits, loadState, error } = state;
    useEffect(() => {
        let active = true;
        async function load() {
            dispatch({ type: 'load:start' });
            try {
                const nextView = await api.getMcpSettings(projectPath);
                if (active)
                    dispatch({ type: 'load:success', view: nextView });
            }
            catch (loadError) {
                if (active)
                    dispatch({ type: 'load:error', error: getErrorMessage(loadError) });
            }
        }
        void load();
        return () => {
            active = false;
        };
    }, [projectPath]);
    async function refresh() {
        dispatch({ type: 'load:start' });
        try {
            dispatch({ type: 'load:success', view: await api.getMcpSettings(projectPath) });
        }
        catch (refreshError) {
            dispatch({ type: 'load:error', error: getErrorMessage(refreshError) });
        }
    }
    async function toggleAdapter() {
        if (!view)
            return;
        dispatch({ type: 'save:start' });
        try {
            dispatch({
                type: 'mutation:success',
                view: await api.setMcpAdapterEnabled(!view.adapter.enabled, projectPath),
            });
        }
        catch (toggleError) {
            dispatch({ type: 'mutation:error', error: getErrorMessage(toggleError) });
        }
    }
    async function toggleServer(server) {
        dispatch({ type: 'save:start' });
        try {
            const nextView = await api.setMcpServerEnabled({
                projectPath,
                sourceId: server.sourceId,
                serverName: server.name,
                enabled: !server.enabled,
            });
            dispatch({ type: 'mutation:success', view: nextView });
        }
        catch (toggleError) {
            dispatch({ type: 'mutation:error', error: getErrorMessage(toggleError) });
        }
    }
    async function saveSelectedSource() {
        if (!view)
            return;
        const selectedSource = getSelectedSource(view, selectedSourceId);
        if (!selectedSource)
            return;
        dispatch({ type: 'save:start' });
        try {
            const nextView = await api.writeMcpSourceConfig({
                projectPath,
                sourceId: selectedSource.id,
                rawJson: rawEdits[selectedSource.id] ?? selectedSource.rawJson,
            });
            dispatch({ type: 'source-save:success', view: nextView, sourceId: selectedSource.id });
            showToast('MCP JSON saved.', 'success');
        }
        catch (saveError) {
            const message = getErrorMessage(saveError);
            dispatch({ type: 'mutation:error', error: message });
            showToast(`MCP JSON was not saved: ${message}`, 'error');
        }
    }
    const selectedSource = view ? getSelectedSource(view, selectedSourceId) : null;
    const rawJson = selectedSource ? (rawEdits[selectedSource.id] ?? selectedSource.rawJson) : '';
    return {
        view,
        error,
        selectedSource,
        rawJson,
        busy: loadState !== 'idle',
        refresh,
        toggleAdapter,
        toggleServer,
        saveSelectedSource,
        selectSource: (sourceId) => dispatch({ type: 'source:select', sourceId }),
        updateRawJson: (sourceId, rawJson) => dispatch({ type: 'raw-edit:change', sourceId, rawJson }),
    };
}

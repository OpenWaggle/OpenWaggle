import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { useReducer, useRef } from 'react';
import { ComposerExtensionActions, } from '@/features/composer/components';
import { agentLoopAuxiliarySurfacePayload, agentLoopInputKey, ExtensionDialogSurfaceContent, ExtensionSidePanelSurfaceContent, resolveExtensionAgentLoopContributionEntries, surfaceLabel, surfaceTarget, } from '@/features/extensions';
import { responseFromExtensionAction } from '../lib/agent-loop-interaction-response-actions';
import { toExtensionInteractionView } from '../lib/agent-loop-interaction-view';
const INITIAL_DIALOG_STATE = {
    activeSurface: null,
    error: null,
};
function reduceComposerExtensionDialogState(state, action) {
    if (action.type === 'open') {
        return { activeSurface: action.surface, error: null };
    }
    if (action.type === 'close') {
        return { ...state, activeSurface: null };
    }
    if (action.type === 'response-started') {
        return { ...state, error: null };
    }
    if (action.type === 'response-succeeded') {
        return state.activeSurface === action.surface ? INITIAL_DIALOG_STATE : state;
    }
    return { ...state, error: action.message };
}
function noOp() { }
function pendingInteractionInputs(interactions) {
    return interactions.map((interaction) => ({
        interaction,
        surfaceInput: {
            surface: 'interaction',
            interaction: toExtensionInteractionView(interaction),
        },
    }));
}
function buildExtensionDialogLaunchers({ registry, projectPaths, inputs, onOpenSurface, }) {
    if (registry === null) {
        return [];
    }
    const launchers = [];
    for (const { interaction, surfaceInput } of inputs) {
        const target = surfaceTarget(surfaceInput);
        const dialogContributions = resolveExtensionAgentLoopContributionEntries({
            registry,
            target,
            requestedProjectPaths: projectPaths,
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS,
        });
        const sidePanelContributions = resolveExtensionAgentLoopContributionEntries({
            registry,
            target,
            requestedProjectPaths: projectPaths,
            family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS,
        });
        for (const contribution of dialogContributions) {
            const entry = contribution.entry;
            const dialogTarget = {
                extensionId: entry.extensionId,
                dialogId: entry.contributionId,
                packagePath: entry.packagePath,
                contentHash: entry.contentHash,
            };
            launchers.push({
                id: `extension-dialog:${entry.packagePath}:${entry.contentHash}:${entry.contributionId}:${agentLoopInputKey(surfaceInput)}`,
                title: entry.title,
                description: `${surfaceLabel(surfaceInput)} from ${entry.extensionName}`,
                badge: 'Dialog',
                onOpen: () => onOpenSurface({
                    kind: 'dialog',
                    interaction,
                    target: dialogTarget,
                    surfacePayload: agentLoopAuxiliarySurfacePayload(surfaceInput, 'dialog'),
                }),
            });
        }
        for (const contribution of sidePanelContributions) {
            const entry = contribution.entry;
            const sidePanelTarget = {
                extensionId: entry.extensionId,
                sidePanelId: entry.contributionId,
                packagePath: entry.packagePath,
                contentHash: entry.contentHash,
            };
            launchers.push({
                id: `extension-side-panel:${entry.packagePath}:${entry.contentHash}:${entry.contributionId}:${agentLoopInputKey(surfaceInput)}`,
                title: entry.title,
                description: `${surfaceLabel(surfaceInput)} from ${entry.extensionName}`,
                badge: 'Side panel',
                onOpen: () => onOpenSurface({
                    kind: 'side-panel',
                    interaction,
                    target: sidePanelTarget,
                    surfacePayload: agentLoopAuxiliarySurfacePayload(surfaceInput, 'side-panel'),
                }),
            });
        }
    }
    return launchers;
}
function ActiveComposerSidePanelSurface({ activeSurface, extensionProjectPaths, extensionRegistry, onClose, onSurfaceAction, }) {
    const surfaceProps = {
        error: null,
        loading: false,
        onClose,
        onRefresh: noOp,
        onSurfaceAction,
        projectPaths: extensionProjectPaths,
        registry: extensionRegistry,
        surfacePayload: activeSurface.surfacePayload,
        target: activeSurface.target,
    };
    return (_jsx("div", { className: "fixed inset-y-4 right-4 z-50 w-[min(420px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border bg-diff-bg shadow-2xl", children: _jsx(ExtensionSidePanelSurfaceContent, { ...surfaceProps }) }));
}
export function ChatComposerExtensionDialogs({ agentInteractions, extensionRegistry, extensionProjectPaths, onRespond, }) {
    const [{ activeSurface, error }, dispatch] = useReducer(reduceComposerExtensionDialogState, INITIAL_DIALOG_STATE);
    const busyInteractionIdRef = useRef(null);
    function openSurface(surface) {
        dispatch({ type: 'open', surface });
    }
    function handleSurfaceAction(actionId, payload) {
        if (activeSurface === null || busyInteractionIdRef.current !== null) {
            return;
        }
        const response = responseFromExtensionAction({
            interaction: activeSurface.interaction,
            actionId,
            payload,
        });
        if (response === null) {
            return;
        }
        const surface = activeSurface;
        dispatch({ type: 'response-started' });
        busyInteractionIdRef.current = surface.interaction.interactionId;
        onRespond(surface.interaction, response)
            .then(() => {
            dispatch({ type: 'response-succeeded', surface });
        })
            .catch((cause) => {
            dispatch({
                type: 'response-failed',
                message: cause instanceof Error ? cause.message : String(cause),
            });
        })
            .finally(() => {
            busyInteractionIdRef.current = null;
        });
    }
    const launchers = buildExtensionDialogLaunchers({
        registry: extensionRegistry,
        projectPaths: extensionProjectPaths,
        inputs: pendingInteractionInputs(agentInteractions),
        onOpenSurface: openSurface,
    });
    return (_jsxs(_Fragment, { children: [_jsx(ComposerExtensionActions, { launchers: launchers }), error ? _jsx("p", { className: "mb-2 text-[12px] text-error", children: error }) : null, activeSurface?.kind === 'dialog' ? (_jsx(ExtensionDialogSurfaceContent, { actions: {
                    onClose: () => dispatch({ type: 'close' }),
                    onRefresh: noOp,
                    onSurfaceAction: handleSurfaceAction,
                }, error: null, loading: false, projectPaths: extensionProjectPaths, registry: extensionRegistry, surfacePayload: activeSurface.surfacePayload, target: activeSurface.target })) : null, activeSurface?.kind === 'side-panel' ? (_jsx(ActiveComposerSidePanelSurface, { activeSurface: activeSurface, extensionProjectPaths: extensionProjectPaths, extensionRegistry: extensionRegistry, onClose: () => dispatch({ type: 'close' }), onSurfaceAction: handleSurfaceAction })) : null] }));
}

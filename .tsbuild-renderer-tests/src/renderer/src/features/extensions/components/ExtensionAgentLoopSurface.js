import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { Bot } from 'lucide-react';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { resolveExtensionAgentLoopContribution, resolveExtensionAgentLoopContributionEntries, } from '../lib/extension-agent-loop-resolution';
import { CUSTOM_INTERACTION_RESPONSE_ACTION_ID, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID, surfaceFamily, surfaceLabel, surfacePayload, surfaceTarget, } from '../lib/extension-agent-loop-surface-model';
import { ExtensionAgentLoopFallback } from './ExtensionAgentLoopFallback';
import { ExtensionContributionRuntimeHost } from './ExtensionContributionRuntimeHost';
export { CUSTOM_INTERACTION_RESPONSE_ACTION_ID, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID };
const TRANSCRIPT_RENDERER_MAX_HEIGHT = 360;
const TOOL_RENDERER_MAX_HEIGHT = 420;
const CUSTOM_MESSAGE_RENDERER_MAX_HEIGHT = 360;
const INTERACTION_RENDERER_MAX_HEIGHT = 360;
const STATUS_RENDERER_MAX_HEIGHT = 160;
const AGENT_LOOP_RENDERER_MIN_HEIGHT = 96;
function ExtensionAgentLoopChrome({ title, children, }) {
    return (_jsxs("section", { className: "rounded-xl border border-border bg-[#111418] p-3 text-text-secondary", children: [_jsxs("div", { className: "mb-3 flex min-w-0 items-center gap-2", children: [_jsx(Bot, { className: "size-4 shrink-0 text-accent" }), _jsx("h3", { className: "truncate text-[12px] font-semibold text-text-primary", children: title })] }), children] }));
}
function agentLoopRendererMaxHeight(input) {
    return matchBy(input, 'surface')
        .with('transcript', () => TRANSCRIPT_RENDERER_MAX_HEIGHT)
        .with('tool', () => TOOL_RENDERER_MAX_HEIGHT)
        .with('custom-message', () => CUSTOM_MESSAGE_RENDERER_MAX_HEIGHT)
        .with('interaction', () => INTERACTION_RENDERER_MAX_HEIGHT)
        .with('status', () => STATUS_RENDERER_MAX_HEIGHT)
        .exhaustive();
}
function ExtensionRenderer({ input, contribution, payload, }) {
    const entry = contribution.entry;
    return (_jsx(PanelErrorBoundary, { name: `Extension renderer: ${entry.title}`, className: "min-h-0", children: _jsx(ExtensionContributionRuntimeHost, { autoHeight: true, chrome: "bare", entry: entry, maxAutoHeight: agentLoopRendererMaxHeight(input), minAutoHeight: AGENT_LOOP_RENDERER_MIN_HEIGHT, onSurfaceAction: input.surface === 'interaction' && input.onAction
                ? (actionId, payload) => input.onAction?.(input.interaction.id, actionId, payload)
                : undefined, surfacePayload: payload }) }));
}
function extensionContributionKey(contribution) {
    const entry = contribution.entry;
    return `${entry.packagePath}:${entry.contentHash}:${entry.contributionId}`;
}
function TranscriptRenderers({ contributions, input, payload, }) {
    return (_jsx("section", { "aria-label": "Transcript extension renderers", className: "grid gap-3", children: contributions.map((contribution) => (_jsx(ExtensionAgentLoopChrome, { title: contribution.entry.title, children: _jsx(ExtensionRenderer, { contribution: contribution, input: input, payload: payload }) }, extensionContributionKey(contribution)))) }));
}
export function ExtensionAgentLoopSurface({ input, registry, projectPaths, fallback, }) {
    const fallbackTitle = surfaceLabel(input);
    const payload = surfacePayload(input);
    const fallbackContent = fallback === undefined ? _jsx(ExtensionAgentLoopFallback, { input: input }) : fallback;
    if (registry === null) {
        if (fallback !== undefined) {
            return fallbackContent;
        }
        return fallbackContent === null ? null : (_jsx(ExtensionAgentLoopChrome, { title: fallbackTitle, children: fallbackContent }));
    }
    const target = surfaceTarget(input);
    const resolution = resolveExtensionAgentLoopContribution({
        registry,
        target,
        requestedProjectPaths: projectPaths,
    });
    if (input.surface === 'transcript') {
        const contributions = resolveExtensionAgentLoopContributionEntries({
            registry,
            target,
            requestedProjectPaths: projectPaths,
            family: surfaceFamily(input),
        });
        if (contributions.length > 0) {
            return _jsx(TranscriptRenderers, { contributions: contributions, input: input, payload: payload });
        }
    }
    if (resolution.status !== 'available' && fallback !== undefined) {
        return fallbackContent;
    }
    const title = resolution.status === 'available' ? resolution.contribution.entry.title : fallbackTitle;
    return (_jsx(ExtensionAgentLoopChrome, { title: title, children: resolution.status === 'available' ? (_jsx(ExtensionRenderer, { input: input, payload: payload, contribution: resolution.contribution })) : (fallbackContent) }));
}

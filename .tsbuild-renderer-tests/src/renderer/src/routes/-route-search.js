import { isMatching, P } from '@diegogbrisa/ts-match';
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, SETTINGS_TABS } from '@/shell/ui-store';
function parseSearchString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
function parseSearchToken(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function parseRightPanel(value) {
    return isMatching(P.union('diff', 'session-tree', EXTENSION_SIDE_PANEL_ROUTE_PANEL), value)
        ? value
        : undefined;
}
export function parseChatRouteSearch(search) {
    const branch = parseSearchString(search.branch);
    const node = parseSearchString(search.node);
    const panel = parseRightPanel(search.panel);
    const base = {
        ...(branch ? { branch } : {}),
        ...(node ? { node } : {}),
        ...(search.diff === 1 || search.diff === '1' ? { diff: 1 } : {}),
    };
    if (panel === EXTENSION_SIDE_PANEL_ROUTE_PANEL) {
        const sidePanelExtensionId = parseSearchToken(search.sidePanelExtensionId);
        const sidePanelId = parseSearchToken(search.sidePanelId);
        const sidePanelPackagePath = parseSearchToken(search.sidePanelPackagePath);
        const sidePanelContentHash = parseSearchToken(search.sidePanelContentHash);
        if (sidePanelExtensionId && sidePanelId) {
            return {
                ...base,
                panel,
                sidePanelExtensionId,
                sidePanelId,
                ...(sidePanelPackagePath ? { sidePanelPackagePath } : {}),
                ...(sidePanelContentHash ? { sidePanelContentHash } : {}),
            };
        }
        return base;
    }
    return {
        ...base,
        ...(panel ? { panel } : {}),
    };
}
export function extensionSidePanelTargetFromSearch(search) {
    if (search.panel !== EXTENSION_SIDE_PANEL_ROUTE_PANEL ||
        !search.sidePanelExtensionId ||
        !search.sidePanelId) {
        return null;
    }
    return {
        extensionId: search.sidePanelExtensionId,
        sidePanelId: search.sidePanelId,
        ...(search.sidePanelPackagePath ? { packagePath: search.sidePanelPackagePath } : {}),
        ...(search.sidePanelContentHash ? { contentHash: search.sidePanelContentHash } : {}),
    };
}
export function isSettingsTab(value) {
    return SETTINGS_TABS.some((tab) => tab === value);
}

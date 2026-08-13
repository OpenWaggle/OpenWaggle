export function resolveRightSidebarPanel(input) {
    if (input.sessionTreeOpen) {
        return 'session-tree';
    }
    if (input.extensionSidePanel) {
        return {
            kind: 'extension-side-panel',
            extensionId: input.extensionSidePanel.extensionId,
            sidePanelId: input.extensionSidePanel.sidePanelId,
            ...(input.extensionSidePanel.packagePath
                ? { packagePath: input.extensionSidePanel.packagePath }
                : {}),
            ...(input.extensionSidePanel.contentHash
                ? { contentHash: input.extensionSidePanel.contentHash }
                : {}),
        };
    }
    if (input.diffOpen) {
        return 'diff';
    }
    return input.lastPanel;
}
export function isExtensionRightSidebarPanel(panel) {
    return typeof panel === 'object' && panel.kind === 'extension-side-panel';
}

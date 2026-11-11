/**
 * Shared menu role definitions used by ApplicationMenu, ContextMenu, and Tray menus.
 * These map to macOS NSResponder selectors for native text editing support.
 */
export declare const roleLabelMap: Record<string, string>;
export type MenuRole = keyof typeof roleLabelMap;

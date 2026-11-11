import "./global.d.ts";
type WebviewEventTypes = "will-navigate" | "did-navigate" | "did-navigate-in-page" | "did-commit-navigation" | "dom-ready" | "host-message" | "new-window-open" | "download-started" | "download-progress" | "download-completed" | "download-failed" | "load-started" | "load-committed" | "load-finished";
/**
 * Interface representing an <electrobun-webview> custom element.
 * Use this to properly type webview elements obtained via querySelector.
 *
 * @example
 * const webview = document.querySelector('electrobun-webview') as WebviewTagElement;
 * webview.loadURL('https://example.com');
 * webview.toggleHidden(false);
 */
interface WebviewTagElement extends HTMLElement {
    webviewId: number | null;
    maskSelectors: Set<string>;
    transparent: boolean;
    passthroughEnabled: boolean;
    spellCheckEnabled: boolean;
    hidden: boolean;
    readonly sandbox: boolean;
    src: string | null;
    html: string | null;
    preload: string | null;
    renderer: "cef" | "native";
    addMaskSelector(selector: string): void;
    removeMaskSelector(selector: string): void;
    canGoBack(): Promise<boolean>;
    canGoForward(): Promise<boolean>;
    goBack(): void;
    goForward(): void;
    reload(): void;
    loadURL(url: string): void;
    loadHTML(html: string): void;
    setSpellCheck(enabled: boolean): Promise<boolean>;
    toggleTransparent(transparent?: boolean): void;
    togglePassthrough(enablePassthrough?: boolean): void;
    toggleHidden(hidden?: boolean): void;
    on(event: WebviewEventTypes, listener: (event: CustomEvent) => void): void;
    off(event: WebviewEventTypes, listener: (event: CustomEvent) => void): void;
    emit(event: WebviewEventTypes, detail: unknown): void;
    syncDimensions(force?: boolean): void;
    setNavigationRules(rules: string[]): void;
    findInPage(searchText: string, options?: {
        forward?: boolean;
        matchCase?: boolean;
    }): void;
    stopFindInPage(): void;
    openDevTools(): void;
    closeDevTools(): void;
    toggleDevTools(): void;
    executeJavascript(js: string): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "electrobun-webview": WebviewTagElement;
    }
}
export { type WebviewTagElement, type WebviewEventTypes };

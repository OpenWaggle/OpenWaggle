export declare const SCROLL_UP_HYSTERESIS_PX = 1;
export declare const SCROLLBAR_HIDE_DELAY_MS = 800;
export declare const SCROLL_PERSIST_DEBOUNCE_MS = 150;
export declare const SESSION_RESTORE_RETRY_MS = 96;
export declare function loadScrollCache(): Map<string, number>;
export declare function saveScrollCache(cache: Map<string, number>): void;

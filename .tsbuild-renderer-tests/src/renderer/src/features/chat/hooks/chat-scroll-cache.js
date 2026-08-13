import { isMatching, P } from '@diegogbrisa/ts-match';
export const SCROLL_UP_HYSTERESIS_PX = 1;
export const SCROLLBAR_HIDE_DELAY_MS = 800;
export const SCROLL_PERSIST_DEBOUNCE_MS = 150;
export const SESSION_RESTORE_RETRY_MS = 96;
const SCROLL_CACHE_MAX_ENTRIES = 100;
// Versioned key: if the persisted shape ever changes, old data is simply not
// found rather than parsed into a crash for users with saved sessions
// (react-doctor/client-localstorage-no-version).
const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions:v1';
function isScrollCacheEntry(value) {
    return isMatching(P.tuple([P.string, P.finite]), value);
}
export function loadScrollCache() {
    try {
        const raw = localStorage.getItem(SCROLL_CACHE_KEY);
        if (!raw)
            return new Map();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return new Map();
        const entries = parsed.filter(isScrollCacheEntry);
        return new Map(entries);
    }
    catch {
        return new Map();
    }
}
export function saveScrollCache(cache) {
    while (cache.size > SCROLL_CACHE_MAX_ENTRIES) {
        const firstKey = cache.keys().next().value;
        if (firstKey === undefined)
            break;
        cache.delete(firstKey);
    }
    try {
        localStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify([...cache]));
    }
    catch {
        // Ignore storage errors.
    }
}

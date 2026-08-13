import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { useChatScrollBehaviour, } from '../useChatScrollBehaviour';
const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions:v1';
const ANIMATION_FRAME_DELAY_MS = 16;
export const SCROLL_PERSIST_DEBOUNCE_MS = 150;
let triggerResize = null;
export function createDefaultParams(overrides = {}) {
    return {
        activeSessionId: 'session-1',
        lastUserMessageId: 'user-1',
        rowsLength: 5,
        streamVersion: 5,
        isLoading: false,
        userDidSend: false,
        onUserDidSendConsumed: vi.fn(),
        ...overrides,
    };
}
function setRef(ref, value) {
    Object.defineProperty(ref, 'current', {
        value,
        writable: true,
        configurable: true,
    });
}
export function createTestLayout({ naturalScrollHeight = 1000, clientHeight = 500, scrollTop = 0, } = {}) {
    const scroller = document.createElement('div');
    const content = document.createElement('div');
    let currentNaturalScrollHeight = naturalScrollHeight;
    let currentScrollTop = scrollTop;
    function getMaxScrollTop() {
        return Math.max(0, currentNaturalScrollHeight - clientHeight);
    }
    function setClampedScrollTop(value) {
        currentScrollTop = Math.min(Math.max(0, value), getMaxScrollTop());
    }
    Object.defineProperty(scroller, 'scrollHeight', {
        get: () => currentNaturalScrollHeight,
        configurable: true,
    });
    Object.defineProperty(scroller, 'clientHeight', {
        get: () => clientHeight,
        configurable: true,
    });
    Object.defineProperty(scroller, 'scrollTop', {
        get: () => currentScrollTop,
        set: setClampedScrollTop,
        configurable: true,
    });
    const scrollToMock = vi.fn((options, y) => {
        if (typeof options === 'number') {
            setClampedScrollTop(y ?? 0);
            return;
        }
        setClampedScrollTop(options?.top ?? 0);
    });
    Object.defineProperty(scroller, 'scrollTo', {
        value: scrollToMock,
        configurable: true,
    });
    return {
        scroller,
        content,
        scrollToMock,
        getScrollTop: () => currentScrollTop,
        setNaturalScrollHeight: (height) => {
            currentNaturalScrollHeight = height;
        },
        setScrollTop: setClampedScrollTop,
    };
}
function attachRefs(hook, layout) {
    setRef(hook.scrollerRef, layout.scroller);
    setRef(hook.contentRef, layout.content);
}
export function renderScrollHook(params, layout) {
    return renderHook((props) => {
        const hook = useChatScrollBehaviour(props);
        attachRefs(hook, layout);
        return hook;
    }, { initialProps: params });
}
export function expectScrollCacheEntry(sessionId, scrollTop) {
    const raw = localStorage.getItem(SCROLL_CACHE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '[]');
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContainEqual([sessionId, scrollTop]);
}
export function flushAnimationFrame() {
    act(() => {
        vi.advanceTimersByTime(ANIMATION_FRAME_DELAY_MS);
    });
}
export function triggerObservedResize() {
    act(() => {
        triggerResize?.();
    });
}
export function installChatScrollTestEnvironment() {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        triggerResize = null;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), ANIMATION_FRAME_DELAY_MS));
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
            window.clearTimeout(handle);
        });
        class TestResizeObserver {
            runCallback;
            constructor(callback) {
                this.runCallback = () => callback([], this);
                triggerResize = this.runCallback;
            }
            observe() { }
            unobserve() { }
            disconnect() { }
        }
        vi.stubGlobal('ResizeObserver', TestResizeObserver);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
        localStorage.clear();
    });
}

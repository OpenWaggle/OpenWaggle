import { vi } from 'vitest';
import { type UseChatScrollBehaviourParams, type UseChatScrollBehaviourResult } from '../useChatScrollBehaviour';
export declare const SCROLL_PERSIST_DEBOUNCE_MS = 150;
export declare function createDefaultParams(overrides?: Partial<UseChatScrollBehaviourParams>): UseChatScrollBehaviourParams;
export interface TestLayout {
    readonly scroller: HTMLDivElement;
    readonly content: HTMLDivElement;
    readonly scrollToMock: ReturnType<typeof vi.fn>;
    getScrollTop: () => number;
    setNaturalScrollHeight: (height: number) => void;
    setScrollTop: (scrollTop: number) => void;
}
export declare function createTestLayout({ naturalScrollHeight, clientHeight, scrollTop, }?: {
    readonly naturalScrollHeight?: number;
    readonly clientHeight?: number;
    readonly scrollTop?: number;
}): {
    scroller: HTMLDivElement;
    content: HTMLDivElement;
    scrollToMock: import("vitest").Mock<(options?: ScrollToOptions | number, y?: number) => void>;
    getScrollTop: () => number;
    setNaturalScrollHeight: (height: number) => void;
    setScrollTop: (value: number) => void;
};
export declare function renderScrollHook(params: UseChatScrollBehaviourParams, layout: TestLayout): import("node_modules/@testing-library/react/types").RenderHookResult<UseChatScrollBehaviourResult, UseChatScrollBehaviourParams>;
export declare function expectScrollCacheEntry(sessionId: string, scrollTop: number): void;
export declare function flushAnimationFrame(): void;
export declare function triggerObservedResize(): void;
export declare function installChatScrollTestEnvironment(): void;

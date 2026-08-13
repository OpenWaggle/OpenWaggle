import type { MutableValueRef, ScrollActions } from './chat-scroll-types';
export interface ScrollEffectRefs {
    readonly scrollerRef: MutableValueRef<HTMLDivElement | null>;
    readonly contentRef: MutableValueRef<HTMLDivElement | null>;
    readonly shouldAutoScrollRef: MutableValueRef<boolean>;
    readonly lastTouchClientYRef: MutableValueRef<number | null>;
    readonly pendingUserScrollUpIntentRef: MutableValueRef<boolean>;
    readonly isPointerScrollActiveRef: MutableValueRef<boolean>;
    readonly pendingRestoreScrollTopRef: MutableValueRef<number | null>;
    readonly lastRestoredSessionRef: MutableValueRef<string | null>;
    readonly hasRestoredScrollRef: MutableValueRef<boolean>;
    readonly previousLastUserMessageIdRef: MutableValueRef<string | null>;
    readonly switchBaselineLastUserMessageIdRef: MutableValueRef<string | null>;
    readonly scrollCacheRef: MutableValueRef<Map<string, number>>;
    readonly persistTimerRef: MutableValueRef<ReturnType<typeof setTimeout> | null>;
    readonly scrollbarTimerRef: MutableValueRef<ReturnType<typeof setTimeout> | null>;
    readonly actionsRef: MutableValueRef<ScrollActions | null>;
}
interface UseChatScrollEffectsParams {
    readonly activeSessionId: string | null;
    readonly lastUserMessageId: string | null;
    readonly rowsLength: number;
    readonly streamVersion: number;
    readonly isLoading: boolean;
    readonly userDidSend: boolean;
    readonly onUserDidSendConsumed: () => void;
    readonly refs: ScrollEffectRefs;
}
export declare function useChatScrollEffects(params: UseChatScrollEffectsParams): void;
export {};

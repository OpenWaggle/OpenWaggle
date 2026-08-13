import type { MutableValueRef } from './chat-scroll-types';
import type { ScrollEffectRefs } from './useChatScrollEffects';
interface ChatScrollRefs extends ScrollEffectRefs {
    readonly lastKnownScrollTopRef: MutableValueRef<number>;
    readonly activeSessionIdRef: MutableValueRef<string | null>;
    readonly pendingAutoScrollFrameRef: MutableValueRef<number | null>;
    readonly pendingRestoreTimerRef: MutableValueRef<ReturnType<typeof setTimeout> | null>;
    readonly effectRefs: ScrollEffectRefs;
}
export declare function useChatScrollRefs(activeSessionId: string | null, lastUserMessageId: string | null): ChatScrollRefs;
export {};

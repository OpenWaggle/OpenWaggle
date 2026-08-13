import type { SessionHydrationContext, SessionHydrationInput } from './useAgentChat.types';
export declare function resetMissingSessionHydration(context: SessionHydrationContext): void;
export declare function hydrateSessionMessages(input: SessionHydrationInput, context: SessionHydrationContext): void;

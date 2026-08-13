import type { ChatActions, ChatState } from './chat-store-types';
type ChatSet = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;
type ChatGet = () => ChatState;
export declare function createChatActions(set: ChatSet, get: ChatGet): ChatActions;
export {};

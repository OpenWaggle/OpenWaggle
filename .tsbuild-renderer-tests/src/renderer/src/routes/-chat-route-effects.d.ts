interface ChatRouteEffectsParams {
    readonly branchId: string | null;
    readonly diffOpen: boolean;
    readonly nodeId: string | null;
    readonly sessionId: string | null;
}
export declare function useChatRouteEffects({ branchId, diffOpen, nodeId, sessionId, }: ChatRouteEffectsParams): void;
export {};

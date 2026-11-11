export type WebviewEventBridgeMessage = {
    id: number;
    eventName: string;
    detail: string;
};
export declare function parseWebviewEventBridgeMessage(sourceId: number, rawMessage: string): WebviewEventBridgeMessage | null;

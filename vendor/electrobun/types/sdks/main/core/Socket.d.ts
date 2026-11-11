export declare const removeSocketForWebview: (webviewId: number) => void;
export declare const sendMessageToWebviewViaSocket: (webviewId: number, message: unknown, secretKey?: Uint8Array, serialized?: boolean) => boolean;

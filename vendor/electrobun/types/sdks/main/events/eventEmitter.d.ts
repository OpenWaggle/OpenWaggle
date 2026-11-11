import EventEmitter from "events";
import ElectrobunEvent from "./event";
declare class ElectrobunEventEmitter extends EventEmitter {
    constructor();
    emitEvent(ElectrobunEvent: ElectrobunEvent<any, any>, specifier?: number | string): void;
    events: {
        window: {
            close: (data: {
                id: number;
            }) => ElectrobunEvent<{
                id: number;
            }, {}>;
            willClose: (data: {
                id: number;
            }) => ElectrobunEvent<{
                id: number;
            }, {
                allow: boolean;
            }>;
            resize: (data: {
                id: number;
                x: number;
                y: number;
                width: number;
                height: number;
            }) => ElectrobunEvent<{
                id: number;
                x: number;
                y: number;
                width: number;
                height: number;
            }, {}>;
            move: (data: {
                id: number;
                x: number;
                y: number;
            }) => ElectrobunEvent<{
                id: number;
                x: number;
                y: number;
            }, {}>;
            focus: (data: {
                id: number;
            }) => ElectrobunEvent<{
                id: number;
            }, {}>;
            blur: (data: {
                id: number;
            }) => ElectrobunEvent<{
                id: number;
            }, {}>;
            keyDown: (data: {
                id: number;
                keyCode: number;
                modifiers: number;
                isRepeat: boolean;
            }) => ElectrobunEvent<{
                id: number;
                keyCode: number;
                modifiers: number;
                isRepeat: boolean;
            }, {}>;
            keyUp: (data: {
                id: number;
                keyCode: number;
                modifiers: number;
                isRepeat: boolean;
            }) => ElectrobunEvent<{
                id: number;
                keyCode: number;
                modifiers: number;
                isRepeat: boolean;
            }, {}>;
        };
        webview: {
            willNavigate: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            didNavigate: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            didNavigateInPage: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            didCommitNavigation: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            domReady: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            newWindowOpen: (data: {
                detail: string | {
                    url: string;
                    isCmdClick: boolean;
                    modifierFlags?: number;
                    targetDisposition?: number;
                    userGesture?: boolean;
                };
            }) => ElectrobunEvent<{
                detail: string | {
                    url: string;
                    isCmdClick: boolean;
                    modifierFlags?: number;
                    targetDisposition?: number;
                    userGesture?: boolean;
                };
            }, {}>;
            hostMessage: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            downloadStarted: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            downloadProgress: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            downloadCompleted: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
            downloadFailed: (data: {
                detail: string;
            }) => ElectrobunEvent<{
                detail: string;
            }, {}>;
        };
        tray: {
            trayClicked: (data: {
                id: number;
                action: string;
                data?: unknown;
            }) => ElectrobunEvent<{
                id: number;
                action: string;
                data?: unknown;
            }, {
                allow: boolean;
            }>;
        };
        app: {
            applicationMenuClicked: (data: {
                id?: number;
                action: string;
                data?: unknown;
            }) => ElectrobunEvent<{
                id?: number;
                action: string;
                data?: unknown;
            }, {
                allow: boolean;
            }>;
            contextMenuClicked: (data: {
                id?: number;
                action: string;
                data?: unknown;
            }) => ElectrobunEvent<{
                id?: number;
                action: string;
                data?: unknown;
            }, {
                allow: boolean;
            }>;
            openUrl: (data: {
                url: string;
            }) => ElectrobunEvent<{
                url: string;
            }, void>;
            reopen: (data: {}) => ElectrobunEvent<{}, void>;
            beforeQuit: (data: {}) => ElectrobunEvent<{}, {
                allow: boolean;
            }>;
        };
    };
}
export declare const electrobunEventEmitter: ElectrobunEventEmitter;
export default electrobunEventEmitter;

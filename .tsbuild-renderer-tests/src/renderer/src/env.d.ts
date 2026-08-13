import type { OpenWaggleApi } from '@shared/types/openwaggle-api';
declare global {
    interface Window {
        api: OpenWaggleApi;
    }
}
export declare const env: {
    readonly isDevelopment: boolean;
    readonly isElectron: boolean;
    readonly logLevel: "info";
};

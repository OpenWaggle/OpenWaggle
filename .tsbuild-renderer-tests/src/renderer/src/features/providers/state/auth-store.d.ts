import type { OAuthAccountInfo, OAuthFlowStatus, OAuthProvider } from '@shared/types/auth';
interface AuthState {
    oauthStatuses: Partial<Record<OAuthProvider, OAuthFlowStatus>>;
    authAccounts: Partial<Record<OAuthProvider, OAuthAccountInfo | null>>;
    startOAuth: (provider: OAuthProvider) => Promise<void>;
    submitAuthCode: (provider: OAuthProvider, code: string) => Promise<void>;
    cancelOAuth: (provider: OAuthProvider) => Promise<void>;
    disconnectAuth: (provider: OAuthProvider) => Promise<void>;
    loadAuthAccount: (provider: OAuthProvider) => Promise<void>;
    loadAllAuthAccounts: (providers?: readonly OAuthProvider[]) => Promise<void>;
    getOAuthStatus: (provider: OAuthProvider) => OAuthFlowStatus;
}
export declare const useAuthStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<AuthState>>;
export {};

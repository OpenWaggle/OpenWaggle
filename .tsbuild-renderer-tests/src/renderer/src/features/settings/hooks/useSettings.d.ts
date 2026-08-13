/**
 * Load settings and provider models on mount. Call once at the app root.
 */
export declare function useSettingsSetup(): void;
/**
 * Preferences-only hook — settings, load state, and preference actions.
 * Does NOT subscribe to provider or auth stores.
 */
export declare function usePreferences(): {
    settings: import("../../../../../shared/types/settings").Settings;
    isLoaded: boolean;
    loadError: string | null;
    setSelectedModel: (model: import("../../chat/hooks/__tests__/useBuildChatRows.test-utils").SupportedModelId) => Promise<void>;
    toggleFavoriteModel: (model: import("../../chat/hooks/__tests__/useBuildChatRows.test-utils").SupportedModelId) => Promise<void>;
    setEnabledModels: (models: string[]) => Promise<void>;
    setProjectPath: (path: string | null) => Promise<void>;
    setThinkingLevel: (preset: import("../../../../../shared/types/settings").ThinkingLevel) => Promise<void>;
    pushRecentProject: (path: string) => Promise<void>;
    retryLoad: () => Promise<void>;
};
/**
 * Provider-only hook — model lists, API testing, provider config actions.
 * Does NOT subscribe to preferences or auth stores.
 */
export declare function useProviders(): {
    isLoading: boolean;
    loadError: string | null;
    testingProviders: Partial<Record<string, boolean>>;
    testResults: Partial<Record<string, {
        success: boolean;
        error?: string;
    } | null>>;
    providerModels: import("../../../../../shared/types/llm").ProviderInfo[];
    updateApiKey: (provider: import("../../../../../shared/types/settings").Provider, apiKey: string) => Promise<void>;
    testApiKey: (provider: import("../../../../../shared/types/settings").Provider, apiKey: string) => Promise<boolean>;
    clearTestResult: (provider: import("../../../../../shared/types/settings").Provider) => void;
};
/**
 * Auth-only hook — OAuth flow status and connected accounts.
 * Does NOT subscribe to preferences or provider stores.
 */
export declare function useAuth(): {
    oauthStatuses: Partial<Record<string, import("../../../../../shared/types/auth").OAuthFlowStatus>>;
    authAccounts: Partial<Record<string, import("../../../../../shared/types/auth").OAuthAccountInfo | null>>;
    startOAuth: (provider: import("../../../../../shared/types/auth").OAuthProvider) => Promise<void>;
    submitAuthCode: (provider: import("../../../../../shared/types/auth").OAuthProvider, code: string) => Promise<void>;
    cancelOAuth: (provider: import("../../../../../shared/types/auth").OAuthProvider) => Promise<void>;
    disconnectAuth: (provider: import("../../../../../shared/types/auth").OAuthProvider) => Promise<void>;
};

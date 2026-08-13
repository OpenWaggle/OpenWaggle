import { create } from 'zustand';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
import { useProviderStore } from './provider-store';
const logger = createRendererLogger('auth');
export const useAuthStore = create((set, get) => ({
    oauthStatuses: {},
    authAccounts: {},
    async startOAuth(provider) {
        set((state) => ({
            oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'in-progress', provider } },
        }));
        const cleanup = api.onOAuthStatus((status) => {
            // Only handle statuses without a provider field (fallback to the active flow's provider).
            // Statuses WITH a provider field are handled by the global listener in useSettingsSetup.
            if (!('provider' in status)) {
                set((state) => ({
                    oauthStatuses: { ...state.oauthStatuses, [provider]: status },
                }));
            }
        });
        try {
            await api.startOAuth(provider);
            await useProviderStore.getState().loadProviderModels();
            await get().loadAuthAccount(provider);
            set((state) => ({
                oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
            }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('Failed to start OAuth flow', { provider, message });
            set((state) => ({
                oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'error', provider, message } },
            }));
            await get().loadAuthAccount(provider);
        }
        finally {
            cleanup();
        }
    },
    async submitAuthCode(provider, code) {
        await api.submitAuthCode(provider, code);
    },
    async cancelOAuth(provider) {
        await api.cancelOAuth(provider);
        await useProviderStore.getState().loadProviderModels();
        await get().loadAuthAccount(provider);
        set((state) => ({
            oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
        }));
    },
    async disconnectAuth(provider) {
        await api.disconnectAuth(provider);
        await useProviderStore.getState().loadProviderModels();
        await get().loadAuthAccount(provider);
        set((state) => ({
            oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
        }));
    },
    async loadAuthAccount(provider) {
        try {
            const info = await api.getAuthAccountInfo(provider);
            set((state) => ({
                authAccounts: { ...state.authAccounts, [provider]: info },
            }));
        }
        catch (err) {
            logger.warn('Failed to load auth account info', { error: String(err) });
        }
    },
    async loadAllAuthAccounts(providers) {
        const providerIds = providers ?? [];
        await Promise.all(providerIds.map((provider) => get().loadAuthAccount(provider)));
    },
    getOAuthStatus(provider) {
        return get().oauthStatuses[provider] ?? { type: 'idle' };
    },
}));

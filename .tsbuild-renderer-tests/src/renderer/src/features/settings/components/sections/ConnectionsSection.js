import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronDown, ChevronRight, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useProviders } from '@/features/settings/hooks/useSettings';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { AvailableModelsSection } from './connections/AvailableModelsSection';
import { OAuthProviderRow } from './connections/OAuthProviderRow';
import { ProviderRow } from './connections/ProviderRow';
function AuthProviderGroup({ title, description, count, isOpen, icon: Icon, emptyText, onToggle, children, }) {
    const Chevron = isOpen ? ChevronDown : ChevronRight;
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: onToggle, "aria-expanded": isOpen, className: cn('flex w-full items-start justify-between gap-4 rounded-md p-1 text-left transition-colors', 'hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-light'), children: [_jsxs("div", { className: "flex min-w-0 items-start gap-2.5", children: [_jsx(Icon, { className: "mt-0.5 size-4 shrink-0 text-text-tertiary" }), _jsxs("div", { className: "min-w-0 space-y-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: title }), _jsx("span", { className: "rounded-md border border-input-card-border bg-[#151a22] px-1.5 py-0.5 text-[11px] font-medium text-text-tertiary", children: count })] }), _jsx("p", { className: "max-w-[720px] text-[12px] leading-5 text-text-tertiary", children: description })] })] }), _jsx(Chevron, { className: "mt-1 size-4 shrink-0 text-text-tertiary" })] }), isOpen &&
                (count > 0 ? (_jsx("div", { className: "overflow-hidden rounded-lg border border-border bg-[#111418]", children: children })) : (_jsx("p", { className: "px-1 text-[13px] text-text-muted", children: emptyText })))] }));
}
export function ConnectionsSection() {
    const { providerModels, isLoading, loadError } = useProviders();
    const [apiKeysOpen, setApiKeysOpen] = useState(false);
    const [oauthOpen, setOauthOpen] = useState(false);
    const apiKeyProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsApiKey);
    const oauthProviders = providerModels.filter((providerInfo) => providerInfo.auth.supportsOAuth);
    const loadingText = 'Loading Pi providers…';
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("h2", { className: "text-[20px] font-semibold text-text-primary", children: "Connections" }), _jsx("p", { className: "text-[13px] text-text-tertiary", children: "Manage the provider authentication methods available through Pi." })] }), loadError && (_jsxs("p", { className: "rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error", children: ["Failed to load providers: ", loadError] })), isLoading && providerModels.length === 0 && (_jsx("p", { className: "text-[13px] text-text-muted", children: "Loading Pi providers\u2026" })), _jsx(AuthProviderGroup, { title: "API Key Providers", description: "Use Pi's API-key, environment, or custom-provider auth for key-based access.", count: apiKeyProviders.length, isOpen: apiKeysOpen, icon: KeyRound, emptyText: isLoading ? loadingText : 'Pi did not report any API-key providers.', onToggle: () => setApiKeysOpen((open) => !open), children: apiKeyProviders.map((providerInfo, index) => (_jsx(ProviderRow, { providerInfo: providerInfo, isLast: index === apiKeyProviders.length - 1 }, providerInfo.provider))) }), _jsx(AuthProviderGroup, { title: "OAuth Providers", description: "Connect with Pi OAuth. OpenWaggle starts Pi's login flow and opens your browser.", count: oauthProviders.length, isOpen: oauthOpen, icon: ShieldCheck, emptyText: isLoading ? loadingText : 'Pi did not report any OAuth providers.', onToggle: () => setOauthOpen((open) => !open), children: oauthProviders.map((providerInfo, index) => (_jsx(OAuthProviderRow, { providerInfo: providerInfo, isLast: index === oauthProviders.length - 1 }, providerInfo.provider))) }), _jsx(AvailableModelsSection, {}), _jsx("p", { className: "text-[13px] text-text-tertiary", children: "API keys are stored locally on your machine and never sent anywhere except to the respective API providers." })] }));
}

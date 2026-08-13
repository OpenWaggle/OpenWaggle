import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useProviders } from '@/features/settings/hooks/useSettings';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { KeyEditor } from './KeyEditor';
import { getProviderMeta } from './meta';
export function ProviderRow({ providerInfo, isLast, autoEdit, onEditingChange }) {
    const { testingProviders, testResults, updateApiKey, testApiKey } = useProviders();
    const [editing, setEditing] = useState(Boolean(autoEdit));
    const providerId = providerInfo.provider;
    const meta = getProviderMeta(providerId);
    const isTesting = testingProviders[providerId] ?? false;
    const isConfigured = providerInfo.auth.apiKeyConfigured;
    const Icon = meta.icon;
    const statusText = providerInfo.auth.apiKeySource === 'api-key'
        ? 'API key configured'
        : providerInfo.auth.apiKeySource === 'environment-or-custom'
            ? 'Configured outside OpenWaggle'
            : 'Not configured';
    const statusColor = isConfigured ? '#34d399' : '#6b7280';
    return (_jsxs("div", { className: cn(!isLast && 'border-b border-border'), children: [_jsxs("div", { className: "flex items-center justify-between h-14 px-5", children: [_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx(Icon, { className: "size-3.5 shrink-0", style: { color: meta.color } }), _jsx("span", { className: "truncate text-[13px] font-medium text-text-primary", children: providerInfo.displayName })] }), _jsxs("div", { className: "flex items-center gap-2.5", children: [_jsxs("div", { className: "flex items-center gap-1 rounded-[10px] px-2 h-[22px]", children: [_jsx("div", { className: "size-1.5 rounded-full", style: { backgroundColor: statusColor } }), _jsx("span", { className: "text-[11px] font-medium", style: { color: statusColor }, children: statusText })] }), _jsx(Button, { variant: "unstyled", type: "button", "aria-label": `Edit ${providerInfo.displayName} API key`, onClick: () => {
                                    const next = !editing;
                                    setEditing(next);
                                    onEditingChange?.(next);
                                }, className: cn('flex items-center justify-center rounded-[5px] border border-input-card-border bg-[#1a1f28] size-7', 'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors'), children: _jsx(Pencil, { className: "size-3" }) })] })] }), editing && (_jsx(KeyEditor, { providerInfo: providerInfo, onSave: (key) => updateApiKey(providerId, key), onClear: () => updateApiKey(providerId, ''), onTest: (key) => testApiKey(providerId, key), isTesting: isTesting, testResult: testResults[providerId] ?? null, onClose: () => {
                    setEditing(false);
                    onEditingChange?.(false);
                } }))] }));
}

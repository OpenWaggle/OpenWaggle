import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Check, ExternalLink, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { TextInput } from '@/shared/ui/TextInput';
export function KeyEditor({ providerInfo, onSave, onClear, onTest, isTesting, testResult, onClose, }) {
    const [value, setValue] = useState('');
    const [showKey, setShowKey] = useState(false);
    const draftValue = value.trim();
    const hasStoredKey = providerInfo.auth.apiKeySource === 'api-key';
    async function handleSave() {
        await onSave(draftValue);
        setValue('');
        onClose();
    }
    async function handleClear() {
        await onClear();
        setValue('');
        onClose();
    }
    return (_jsxs("div", { className: "border-t border-border px-5 py-4 space-y-3", children: [_jsx(KeyEditorHeader, { providerInfo: providerInfo, onClose: onClose }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(KeyInput, { providerInfo: providerInfo, hasStoredKey: hasStoredKey, state: { value: draftValue, showKey }, actions: {
                            onChange: setValue,
                            onToggleVisibility: () => setShowKey((current) => !current),
                        } }), _jsx(KeyEditorButtons, { state: { draftValue, hasStoredKey, isTesting }, actions: {
                            onTest: () => void onTest(draftValue),
                            onSave: () => void handleSave(),
                            onClear: () => void handleClear(),
                        } })] }), _jsx(KeyTestResult, { result: testResult }), providerInfo.auth.apiKeySource === 'environment-or-custom' && _jsx(EnvironmentKeyNotice, {})] }));
}
function KeyEditorHeader({ providerInfo, onClose, }) {
    return (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[13px] font-medium text-text-secondary", children: "Pi Auth Key" }), _jsxs("div", { className: "flex items-center gap-2", children: [providerInfo.apiKeyManagementUrl && (_jsxs("a", { href: providerInfo.apiKeyManagementUrl, target: "_blank", rel: "noreferrer", className: "inline-flex items-center gap-1 text-[12px] font-medium text-link-yellow hover:opacity-90 transition-opacity", children: ["Get API key", _jsx(ExternalLink, { className: "size-3" })] })), _jsx(Button, { variant: "unstyled", type: "button", onClick: onClose, className: "rounded p-0.5 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors", children: _jsx(X, { className: "size-3.5" }) })] })] }));
}
function KeyInput({ providerInfo, hasStoredKey, state, actions, }) {
    return (_jsxs("div", { className: "relative flex-1", children: [_jsx(TextInput, { type: state.showKey ? 'text' : 'password', value: state.value, onChange: (event) => actions.onChange(event.target.value), placeholder: hasStoredKey
                    ? `Enter a new ${providerInfo.displayName} key to replace the stored key`
                    : `Enter your ${providerInfo.displayName} API key`, monospace: true, className: "rounded-lg border-input-card-border pr-9 text-[13px] placeholder:text-text-muted focus:border-border-light" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: actions.onToggleVisibility, className: "absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary", children: state.showKey ? _jsx(EyeOff, { className: "size-3.5" }) : _jsx(Eye, { className: "size-3.5" }) })] }));
}
function KeyEditorButtons({ state, actions, }) {
    return (_jsxs(_Fragment, { children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: actions.onTest, disabled: !state.draftValue || state.isTesting, className: cn('flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors', state.draftValue && !state.isTesting
                    ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-input-card-border'
                    : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border'), children: state.isTesting ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "size-3.5 animate-spin" }), "Testing"] })) : ('Test') }), _jsx(Button, { variant: "unstyled", type: "button", onClick: actions.onSave, disabled: !state.draftValue, className: cn('rounded-md px-3 py-2 text-[12px] font-medium transition-colors', state.draftValue
                    ? 'bg-accent text-black hover:bg-accent/90'
                    : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border'), children: "Save" }), state.hasStoredKey && (_jsx(Button, { variant: "unstyled", type: "button", onClick: actions.onClear, className: "rounded-md border border-input-card-border bg-bg-tertiary px-3 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", children: "Clear" }))] }));
}
function KeyTestResult({ result }) {
    if (!result)
        return null;
    return (_jsx("div", { className: cn('flex items-center gap-1.5 text-[12px]', result.success ? 'text-success' : 'text-error'), children: result.success ? (_jsxs(_Fragment, { children: [_jsx(Check, { className: "size-3" }), "Connection successful"] })) : (_jsxs(_Fragment, { children: [_jsx(X, { className: "size-3" }), result.error ?? 'Connection failed — check your API key'] })) }));
}
function EnvironmentKeyNotice() {
    return (_jsx("p", { className: "text-[11px] text-text-tertiary", children: "Pi currently sees this provider through environment variables, cloud credentials, or a custom models.json provider." }));
}

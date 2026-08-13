import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/Button';
const logger = createRendererLogger('settings');
function useAppVersion() {
    const [version, setVersion] = useState('…');
    useEffect(() => {
        if (typeof api.getAppVersion !== 'function')
            return;
        api
            .getAppVersion()
            .then(setVersion)
            .catch((err) => {
            logger.warn('Failed to load app version', { error: String(err) });
        });
    }, []);
    return version;
}
function useUpdateStatus() {
    const [status, setStatus] = useState({ type: 'idle' });
    useEffect(() => {
        if (typeof api.getUpdateStatus !== 'function')
            return;
        api
            .getUpdateStatus()
            .then(setStatus)
            .catch((err) => {
            logger.warn('Failed to load update status', { error: String(err) });
        });
    }, []);
    useEffect(() => {
        if (typeof api.onUpdateStatus !== 'function')
            return;
        return api.onUpdateStatus(setStatus);
    }, []);
    return status;
}
const UP_TO_DATE = {
    subtitle: 'You are up to date',
    subtitleClass: 'text-[#9098a8]',
    dotClass: null,
};
function getStatusRow(status) {
    return matchBy(status, 'type')
        .with('idle', () => UP_TO_DATE)
        .with('not-available', () => UP_TO_DATE)
        .with('checking', () => ({
        subtitle: 'Checking for updates…',
        subtitleClass: 'text-[#9098a8]',
        dotClass: null,
    }))
        .with('available', (s) => ({
        subtitle: `Downloading v${s.version}…`,
        subtitleClass: 'text-[#61a8ff]',
        dotClass: 'bg-[#61a8ff]',
    }))
        .with('downloading', (s) => ({
        subtitle: `Downloading v${s.version}… ${Math.round(s.percent)}%`,
        subtitleClass: 'text-[#61a8ff]',
        dotClass: 'bg-[#61a8ff]',
    }))
        .with('downloaded', (s) => ({
        subtitle: `v${s.version} ready to install`,
        subtitleClass: 'text-[#4caf72]',
        dotClass: 'bg-[#4caf72]',
    }))
        .with('error', () => ({
        subtitle: 'Update check failed',
        subtitleClass: 'text-[#ef4444]',
        dotClass: 'bg-[#ef4444]',
    }))
        .exhaustive();
}
export function GeneralSection() {
    const version = useAppVersion();
    const status = useUpdateStatus();
    const statusRow = getStatusRow(status);
    const canCheck = status.type === 'idle' || status.type === 'not-available' || status.type === 'error';
    const isDownloaded = status.type === 'downloaded';
    const isChecking = status.type === 'checking';
    return (_jsx("div", { className: "space-y-6", children: _jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-[#e7e9ee]", children: "About & Updates" }), _jsxs("div", { className: "overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]", children: [_jsx("div", { className: "flex h-14 items-center justify-between border-b border-[#1e2229] px-5", children: _jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-medium text-[#e7e9ee]", children: "Version" }), _jsxs("span", { className: "text-[12px] text-[#9098a8]", children: ["OpenWaggle v", version] })] }) }), _jsxs("div", { className: "flex h-14 items-center justify-between px-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [statusRow.dotClass ? (_jsx("div", { className: `size-2 shrink-0 rounded-full ${statusRow.dotClass}` })) : isChecking ? (_jsx(Loader2, { className: "size-3 shrink-0 animate-spin text-[#9098a8]" })) : null, _jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-medium text-[#e7e9ee]", children: "Latest version" }), _jsx("span", { className: `text-[12px] ${statusRow.subtitleClass}`, children: statusRow.subtitle })] })] }), _jsxs("div", { children: [canCheck && (_jsxs(Button, { variant: "secondary", size: "xs", onClick: () => {
                                                if (typeof api.checkForUpdates === 'function') {
                                                    api.checkForUpdates().catch((err) => {
                                                        logger.warn('Failed to check for updates', { error: String(err) });
                                                    });
                                                }
                                            }, className: "h-7 border-[#2a2f3a] bg-[#1a1f28] text-[#c9cdd6] hover:bg-[#222830]", children: [_jsx(RefreshCw, { className: "size-3" }), "Check now"] })), isDownloaded && (_jsxs(Button, { variant: "primary", size: "xs", onClick: () => {
                                                if (typeof api.installUpdate === 'function') {
                                                    api.installUpdate().catch((err) => {
                                                        logger.warn('Failed to install update', { error: String(err) });
                                                    });
                                                }
                                            }, className: "h-7 bg-[#f5a623] text-white hover:bg-[#e09520]", children: [_jsx(RotateCcw, { className: "size-3" }), "Restart to update"] }))] })] })] })] }) }));
}

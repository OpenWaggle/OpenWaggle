import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MCP_ADAPTER_PACKAGE_SOURCE } from '@shared/constants/mcp';
import { AlertTriangle, CheckCircle2, Network, RotateCw } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
function formatServerDetail(server) {
    if (server.transport === 'http' && server.url)
        return server.url;
    if (server.transport === 'stdio' && server.command)
        return server.command;
    return 'No transport configured';
}
function formatDirectTools(mode) {
    if (mode === 'enabled')
        return 'Direct tools';
    if (mode === 'partial')
        return 'Selected direct tools';
    if (mode === 'disabled')
        return 'Proxy only';
    return 'Inherits direct-tools setting';
}
function SourceButton({ source, selected, onSelect, }) {
    const statusLabel = source.parseError ? 'Invalid' : source.exists ? 'Found' : 'Empty';
    return (_jsxs(Button, { variant: "unstyled", type: "button", onClick: onSelect, className: cn('rounded-lg border p-3 text-left transition-colors', selected
            ? 'border-accent/40 bg-accent/5 text-text-primary'
            : 'border-border bg-bg hover:border-border-light text-text-secondary'), children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-[13px] font-medium", children: source.label }), _jsx("div", { className: "mt-1 truncate text-[11px] text-text-muted", children: source.path })] }), _jsx("span", { className: cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', source.parseError
                            ? 'bg-error/10 text-error'
                            : source.exists
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-bg-tertiary text-text-muted'), children: statusLabel })] }), source.parseError ? (_jsx("div", { className: "mt-2 line-clamp-2 text-[11px] text-error", children: source.parseError })) : (_jsxs("div", { className: "mt-2 flex gap-2 text-[11px] text-text-tertiary", children: [_jsxs("span", { children: [source.serverCount, " active"] }), _jsxs("span", { children: [source.disabledServerCount, " disabled"] })] }))] }));
}
function ServerRow({ server, busy, onToggle, }) {
    return (_jsxs("div", { className: "flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-[13px] font-medium text-text-primary", children: server.name }), _jsx("span", { className: cn('rounded px-1.5 py-0.5 text-[10px] font-medium', server.enabled
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : 'bg-bg-tertiary text-text-muted'), children: server.enabled ? 'Enabled' : 'Disabled' }), _jsx("span", { className: "rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary", children: formatDirectTools(server.directTools) })] }), _jsx("div", { className: "mt-1 truncate text-[12px] text-text-tertiary", children: formatServerDetail(server) }), _jsxs("div", { className: "mt-1 truncate text-[11px] text-text-muted", children: ["Source: ", server.sourceLabel] })] }), _jsx(ToggleSwitch, { checked: server.enabled, disabled: busy, label: `${server.enabled ? 'Disable' : 'Enable'} ${server.name}`, onCheckedChange: onToggle })] }));
}
export function McpSectionHeading() {
    return (_jsxs("div", { className: "space-y-1", children: [_jsx("h2", { className: "text-[20px] font-semibold text-text-primary", children: "MCP" }), _jsx("p", { className: "max-w-[760px] text-[13px] leading-5 text-text-tertiary", children: "MCP support is powered by a Pi extension package. OpenWaggle manages the effective config hierarchy and Pi picks up changes on the next turn." })] }));
}
export function McpErrorAlert({ message }) {
    if (!message)
        return null;
    return (_jsx("p", { role: "alert", className: "rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error", children: message }));
}
function McpAdapterStatus({ enabled }) {
    return enabled ? (_jsxs("span", { className: "inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-300", children: [_jsx(CheckCircle2, { className: "size-3" }), "Enabled"] })) : (_jsxs("span", { className: "inline-flex items-center gap-1 rounded bg-bg-tertiary px-1.5 py-0.5 text-[11px] text-text-muted", children: [_jsx(AlertTriangle, { className: "size-3" }), "Off"] }));
}
export function McpAdapterCard({ view, busy, onRefresh, onToggle, }) {
    const adapterEnabled = view?.adapter.enabled ?? false;
    return (_jsx("div", { className: "rounded-lg border border-border bg-[#111418] p-5", children: _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "min-w-0 space-y-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Network, { className: "size-4 text-accent" }), _jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Pi MCP extension" }), _jsx(McpAdapterStatus, { enabled: adapterEnabled })] }), _jsxs("p", { className: "text-[12px] text-text-tertiary", children: ["Package source: ", view?.adapter.packageSource ?? MCP_ADAPTER_PACKAGE_SOURCE] }), view?.runtimeConfigPath && (_jsxs("p", { className: "truncate text-[11px] text-text-muted", children: ["Runtime bridge config: ", view.runtimeConfigPath] }))] }), _jsxs("div", { className: "flex shrink-0 items-center gap-2", children: [_jsx(Button, { disabled: busy, onClick: onRefresh, leftIcon: _jsx(RotateCw, { className: "size-3" }), children: "Refresh" }), _jsxs("div", { className: "flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-1.5", children: [_jsx("span", { className: "text-[12px] font-medium text-text-secondary", children: adapterEnabled ? 'On' : 'Off' }), _jsx(ToggleSwitch, { checked: adapterEnabled, disabled: !view || busy, label: `${adapterEnabled ? 'Disable' : 'Enable'} Pi MCP extension`, onCheckedChange: onToggle })] })] })] }) }));
}
export function McpSourcesPanel({ sources, selectedSource, onSelectSource, }) {
    return (_jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Sources" }), _jsx("div", { className: "grid grid-cols-2 gap-3", children: sources.map((source) => (_jsx(SourceButton, { source: source, selected: selectedSource?.id === source.id, onSelect: () => onSelectSource(source.id) }, source.id))) })] }));
}
export function McpServersPanel({ servers, busy, onToggleServer, }) {
    return (_jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Effective servers" }), _jsx("div", { className: "overflow-hidden rounded-lg border border-border bg-[#111418]", children: servers.length > 0 ? (servers.map((server) => (_jsx(ServerRow, { server: server, busy: busy, onToggle: () => onToggleServer(server) }, `${server.sourceId}:${server.name}`)))) : (_jsx("p", { className: "px-4 py-6 text-[13px] text-text-muted", children: "No MCP servers configured." })) })] }));
}

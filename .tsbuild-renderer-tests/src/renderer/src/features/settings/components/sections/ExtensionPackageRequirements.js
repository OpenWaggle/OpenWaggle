import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { match } from '@diegogbrisa/ts-match';
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { AlertTriangle, CheckCircle2, TerminalSquare } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
function valueList(values) {
    return values.length > 0 ? values.join(', ') : 'Not specified';
}
function RuntimeRequirement({ requirement, }) {
    const detail = match(requirement)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_BINARY }, (value) => `Binary: ${value.binary}`)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND }, (value) => `Command: ${value.path}`)
        .exhaustive();
    return (_jsx("li", { className: "rounded-md border border-border/70 bg-bg-tertiary/40 px-3 py-2", children: _jsxs("div", { className: "flex items-start gap-2", children: [_jsx(TerminalSquare, { className: "mt-0.5 size-3.5 shrink-0 text-text-tertiary" }), _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-[12px] font-medium text-text-secondary", children: requirement.label }), _jsx("div", { className: "mt-0.5 text-[11px] text-text-muted", children: detail }), _jsx("div", { className: "mt-1 text-[10px] uppercase tracking-[0.14em] text-text-tertiary", children: "Diagnostic only \u00B7 OpenWaggle does not install this automatically" })] })] }) }));
}
function privilegeDetail(requirement) {
    return match(requirement)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY }, (value) => `Capability ${value.capabilityId}; methods ${valueList(value.methods ?? [])}; scopes ${valueList(value.scopes ?? [])}`)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK }, (value) => `Origins ${valueList(value.origins)}; access ${valueList(value.accessModes)}`)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_LOCAL_BUILD }, (value) => `Build command ${value.command ?? 'not declared'}; outputs ${String(value.outputCount)}`)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN }, (value) => `Main-process entry ${value.path}`)
        .with({ kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER }, (value) => `Trusted renderer entry ${value.path}`)
        .exhaustive();
}
function PrivilegeRequirement({ requirement, }) {
    const granted = requirement.granted;
    return (_jsx("li", { className: "rounded-md border border-border/70 bg-bg-tertiary/40 px-3 py-2", children: _jsxs("div", { className: "flex items-start gap-2", children: [granted ? (_jsx(CheckCircle2, { className: "mt-0.5 size-3.5 shrink-0 text-emerald-300" })) : (_jsx(AlertTriangle, { className: "mt-0.5 size-3.5 shrink-0 text-amber-300" })), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "text-[12px] font-medium text-text-secondary", children: requirement.label }), _jsx("span", { className: cn('rounded px-1.5 py-0.5 text-[10px] font-medium', granted ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'), children: granted ? 'Granted' : 'Needs consent' })] }), _jsx("div", { className: "mt-0.5 text-[11px] text-text-muted", children: privilegeDetail(requirement) })] })] }) }));
}
export function ExtensionPackageRequirements({ requirements, }) {
    if (!requirements ||
        (requirements.privileges.length === 0 && requirements.runtime.length === 0)) {
        return null;
    }
    return (_jsxs("section", { className: "mt-4 rounded-lg border border-border bg-bg-secondary/40 p-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { children: [_jsx("h4", { className: "text-[12px] font-semibold text-text-secondary", children: "Extension requirements" }), _jsx("p", { className: "mt-1 text-[11px] text-text-muted", children: "Review these before trusting this package. Trust grants permissions for the current content hash only." })] }), requirements.consentRequired ? (_jsxs("span", { className: "rounded bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300", children: [requirements.missingGrantIds.length, " consent pending"] })) : null] }), requirements.privileges.length > 0 ? (_jsx("ul", { className: "mt-3 space-y-2", "aria-label": "Privileged extension requirements", children: requirements.privileges.map((requirement) => (_jsx(PrivilegeRequirement, { requirement: requirement }, `${requirement.kind}:${requirement.id}`))) })) : null, requirements.runtime.length > 0 ? (_jsx("ul", { className: "mt-3 space-y-2", "aria-label": "Runtime extension requirements", children: requirements.runtime.map((requirement) => (_jsx(RuntimeRequirement, { requirement: requirement }, `${requirement.kind}:${requirement.id}`))) })) : null] }));
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function NoProjectState() {
    return (_jsx("div", { className: "flex h-full items-center justify-center bg-bg", children: _jsxs("div", { className: "rounded-xl border border-border bg-bg-secondary px-6 py-5 text-center", children: [_jsx("p", { className: "text-sm font-medium text-text-primary", children: "No project selected" }), _jsx("p", { className: "mt-1 text-[13px] text-text-tertiary", children: "Select a project folder to manage AGENTS.md and project skills." })] }) }));
}
export function EmptySkillsState() {
    return (_jsx("div", { className: "rounded-lg border border-border bg-bg-secondary p-3 text-[12px] text-text-tertiary", children: "No skills found under `.openwaggle/skills` or `.agents/skills`." }));
}

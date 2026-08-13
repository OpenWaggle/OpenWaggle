import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
export function BranchPickerList({ filteredBranches, localBranches, remoteBranches, selectedRef, onSelectRef, }) {
    return (_jsxs("div", { className: "max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg", children: [filteredBranches.length === 0 ? _jsx(BranchPickerEmptyState, {}) : null, localBranches.length > 0 ? (_jsx(BranchPickerSection, { label: "Local", branches: localBranches, selectedRef: selectedRef, onSelectRef: onSelectRef })) : null, remoteBranches.length > 0 ? (_jsx(BranchPickerSection, { label: "Remote", branches: remoteBranches, selectedRef: selectedRef, onSelectRef: onSelectRef })) : null] }));
}
function BranchPickerEmptyState() {
    return _jsx("div", { className: "px-2.5 py-2 text-[12px] text-text-tertiary", children: "No branches found." });
}
function BranchPickerSection({ label, branches, selectedRef, onSelectRef, }) {
    return (_jsxs("div", { children: [_jsx("div", { className: "border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted", children: label }), branches.map((branch) => (_jsx(RefRow, { branch: branch, isSelected: branch.name === selectedRef, onSelectRef: onSelectRef }, branch.fullName)))] }));
}
/**
 * Selection is marked against the resolved run target, not against
 * `branch.isCurrent`: in worktree mode the run starts from the chosen base ref,
 * which is usually not the checked-out branch.
 */
function RefRow({ branch, isSelected, onSelectRef }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => onSelectRef(branch.name), "aria-current": isSelected || undefined, className: cn('flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors last:border-b-0 hover:bg-bg-hover', isSelected ? 'text-accent' : 'text-text-secondary'), children: [_jsx("span", { className: "truncate", children: branch.name }), isSelected ? _jsx("span", { "aria-hidden": "true", children: "\u25CF" }) : null] }));
}

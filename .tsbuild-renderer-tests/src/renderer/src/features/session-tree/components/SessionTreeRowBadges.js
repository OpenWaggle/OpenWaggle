import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SessionTreeBadge } from './SessionTreeBadge';
export function SessionTreeRowBadges({ archivedBranch, childPathCount, isActiveBranchHead, isDraftNode, nodeBranches, }) {
    return (_jsxs("span", { className: "ml-auto flex shrink-0 items-center gap-1 pl-2", children: [childPathCount > 1 ? (_jsx(SessionTreeBadge, { label: `${childPathCount} paths`, tone: "muted" })) : null, isDraftNode ? _jsx(SessionTreeBadge, { label: "Draft", tone: "warning" }) : null, isActiveBranchHead ? _jsx(SessionTreeBadge, { label: "Active", tone: "accent" }) : null, archivedBranch ? _jsx(SessionTreeBadge, { label: "Archived", tone: "muted" }) : null, nodeBranches.map((branch) => (_jsx(SessionTreeBadge, { label: branch.name, tone: "muted" }, String(branch.id))))] }));
}

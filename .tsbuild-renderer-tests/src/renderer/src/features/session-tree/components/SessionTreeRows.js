import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { sessionTreeNodeLabel, sessionTreeNodeRoleLabel } from '../lib/session-tree-row-labels';
import { buildSessionTreeRowState } from '../lib/session-tree-row-state';
import { getSessionTreeRowGeometry } from '../lib/session-tree-visibility';
import { SessionTreeConnectorOverlay } from './SessionTreeConnectorOverlay';
import { SessionTreeNodeDot } from './SessionTreeNodeDot';
import { SessionTreeRowBadges } from './SessionTreeRowBadges';
function SessionTreeRowItem({ actions, index, refs, row, view }) {
    const rowState = buildSessionTreeRowState({ row, view });
    const geometry = getSessionTreeRowGeometry(row);
    return (_jsxs("div", { className: "session-tree-row-enter group flex min-w-0 items-center", children: [_jsxs("div", { className: "relative h-10 shrink-0", style: { width: geometry.gutterWidthPx }, children: [_jsx(SessionTreeConnectorOverlay, { geometry: geometry, active: rowState.activePath }), _jsx(SessionTreeNodeDot, { expanded: rowState.expanded, geometry: geometry, highlighted: rowState.nodeHighlighted, row: row, onFocus: () => actions.focusIndex(index), onToggle: () => actions.toggleNodeExpanded(row) })] }), _jsxs(Button, { variant: "unstyled", ref: (element) => {
                    if (element) {
                        refs.rowRefs.current.set(String(rowState.node.id), element);
                    }
                    else {
                        refs.rowRefs.current.delete(String(rowState.node.id));
                    }
                }, type: "button", tabIndex: index === view.clampedFocusIndex ? 0 : -1, "aria-current": rowState.nodeHighlighted ? 'true' : undefined, onFocus: () => actions.focusIndex(index), onClick: () => actions.selectNode(rowState.node), className: cn('flex min-h-8 min-w-0 flex-1 items-center rounded-lg border px-2.5 py-1 text-left transition-[background-color,border-color,color,transform] duration-150 ease-out focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent', rowState.rowHighlighted
                    ? 'border-accent/25 bg-accent/7 text-text-primary shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-accent)_18%,transparent)]'
                    : rowState.activePath
                        ? 'border-transparent text-text-primary hover:border-accent/15 hover:bg-accent/5'
                        : 'border-transparent text-text-tertiary hover:border-border-light/70 hover:bg-bg-hover/55 hover:text-text-secondary', rowState.archivedBranch && !rowState.nodeHighlighted && 'opacity-70'), children: [_jsxs("span", { className: "min-w-0 flex-1 truncate", children: [_jsx("span", { className: cn('mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted', rowState.nodeHighlighted && 'text-accent/80'), children: sessionTreeNodeRoleLabel(rowState.node) }), _jsx("span", { className: "text-[12px]", children: sessionTreeNodeLabel(rowState.node) })] }), _jsx(SessionTreeRowBadges, { archivedBranch: rowState.archivedBranch, childPathCount: row.expandableChildCount, isActiveBranchHead: rowState.isActiveBranchHead, isDraftNode: rowState.isDraftNode, nodeBranches: rowState.nodeBranches })] })] }));
}
export function SessionTreeRows({ actions, refs, view }) {
    return (_jsx("div", { children: view.visibleRows.map((row, index) => (_jsx(SessionTreeRowItem, { actions: actions, index: index, refs: refs, row: row, view: view }, String(row.node.id)))) }));
}

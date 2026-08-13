import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { SessionId } from '@shared/types/brand';
import { resolveSessionStatusPill, TERMINAL_STATUSES } from '@shared/types/session-status';
import { AlertTriangle, ChevronDown, ChevronRight, CircleCheck, CirclePause, ClipboardList, GitCompareArrows, Loader2, MessageCircle, MoreHorizontal, XCircle, } from 'lucide-react';
import { useState } from 'react';
import { useSessionStatusStore } from '@/features/sessions/state';
import { WaggleBeeIcon } from '@/features/waggle/components';
import { cn } from '@/shared/lib/cn';
import { formatRelativeTime, truncate } from '@/shared/lib/format';
import { Button } from '@/shared/ui/Button';
import { useSessionGitIndicator } from '../hooks/useSessionGitIndicators';
import { SessionItemContextMenu } from './SessionItemContextMenu';
const TITLE_TRUNCATE_LENGTH = 29;
const ITEM_VARIANT_CLASS = {
    project: 'pl-8 pr-3',
    root: 'pl-4 pr-3',
};
const ICON_MAP = {
    GitCompareArrows,
    Loader2,
    CircleCheck,
    CirclePause,
    MessageCircle,
    ClipboardList,
    XCircle,
    WaggleBee: WaggleBeeIcon,
};
function toSessionId(sessionId) {
    return SessionId(String(sessionId));
}
function BranchDisclosureButton({ visible, collapsed, onToggle, }) {
    if (!visible) {
        return null;
    }
    const DisclosureIcon = collapsed ? ChevronRight : ChevronDown;
    return (_jsx(Button, { variant: "unstyled", type: "button", "aria-label": collapsed ? 'Expand branches' : 'Collapse branches', onClick: (event) => {
            event.stopPropagation();
            onToggle?.();
        }, className: "mr-1 flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", children: _jsx(DisclosureIcon, { className: "size-3" }) }));
}
function SessionStatusMarkers({ pill, StatusIcon, hasInterruptedRun, }) {
    return (_jsxs(_Fragment, { children: [pill && StatusIcon ? (_jsx("span", { className: "mr-2 flex size-3.5 shrink-0 items-center justify-center", children: _jsx(StatusIcon, { className: cn('size-3.5', pill.colorClass, pill.animateClass) }) })) : null, hasInterruptedRun ? (_jsx("span", { className: "mr-2 flex size-3.5 shrink-0 items-center justify-center text-amber-400", title: "A run was interrupted in this session", children: _jsx(AlertTriangle, { className: "size-3.5" }) })) : null] }));
}
function useSessionItemStatus(sessionId, session) {
    const status = useSessionStatusStore((s) => s.statuses.get(sessionId) ?? 'idle');
    const completedAt = useSessionStatusStore((s) => s.completedAt.get(sessionId));
    const lastVisited = useSessionStatusStore((s) => s.lastVisitedAt.get(sessionId));
    const isTerminal = TERMINAL_STATUSES.has(status);
    const isSeen = isTerminal &&
        completedAt !== undefined &&
        lastVisited !== undefined &&
        completedAt <= lastVisited;
    const visibleStatus = isSeen ? 'idle' : status;
    const pill = resolveSessionStatusPill(visibleStatus);
    return {
        pill,
        StatusIcon: pill ? (ICON_MAP[pill.icon] ?? null) : null,
        hasInterruptedRun: session.branches?.some((branch) => branch.interruptedRun) ?? false,
    };
}
function SessionTitleButton({ isActive, session, sessionId, onSelect, }) {
    return (_jsx(Button, { variant: "unstyled", type: "button", onClick: () => onSelect(sessionId), className: "min-w-0 flex-1 truncate text-left", children: _jsx("span", { className: cn('truncate text-[12px]', isActive ? 'font-medium text-text-primary' : 'text-text-secondary'), children: truncate(session.title, TITLE_TRUNCATE_LENGTH) }) }));
}
function SessionActionsTrigger({ menuOpen, session, onClick, }) {
    return (_jsxs("div", { className: "relative ml-auto h-5 w-14 shrink-0", children: [_jsx(Button, { variant: "unstyled", type: "button", "aria-label": `Open session actions for ${session.title}`, onClick: onClick, className: cn('peer absolute inset-y-0 right-0 z-10 flex size-5 items-center justify-center rounded text-text-tertiary opacity-0 transition-[background-color,color,opacity] hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100', menuOpen ? 'opacity-100' : null), children: _jsx(MoreHorizontal, { className: "size-3.5" }) }), _jsx("span", { className: cn('pointer-events-none absolute inset-y-0 right-0 flex items-center text-right text-[11px] text-text-tertiary transition-opacity group-hover:opacity-0 peer-focus:opacity-0', menuOpen ? 'opacity-0' : 'opacity-100'), children: formatRelativeTime(session.updatedAt) })] }));
}
/**
 * This session's working-tree state, from status keyed by its own working path.
 * Absent until that path's status is known, so an unfetched session never looks clean.
 */
function SessionGitBadge({ session }) {
    const indicator = useSessionGitIndicator(session);
    if (indicator.label === '')
        return null;
    return (_jsx("span", { role: "img", title: indicator.description, "aria-label": indicator.description, className: cn('ml-1 shrink-0 whitespace-nowrap text-[10px] tabular-nums', indicator.isDirty ? 'text-accent' : 'text-text-tertiary'), children: indicator.label }));
}
export function SessionListItem({ session, isActive, variant = 'root', actions, branchDisclosure, }) {
    const sessionId = toSessionId(session.id);
    const { pill, StatusIcon, hasInterruptedRun } = useSessionItemStatus(sessionId, session);
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
    function handleContextMenu(e) {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
        setMenuOpen(true);
    }
    function handleActionsClick(event) {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setMenuPos({ x: rect.left, y: rect.bottom });
        setMenuOpen(true);
    }
    return (_jsxs("li", { "aria-current": isActive ? 'true' : undefined, className: cn('group mx-2 flex h-[34px] items-center rounded-md', ITEM_VARIANT_CLASS[variant], isActive ? 'bg-bg-active' : 'hover:bg-bg-hover'), onContextMenu: handleContextMenu, children: [_jsx(BranchDisclosureButton, { visible: branchDisclosure?.visible ?? false, collapsed: branchDisclosure?.collapsed ?? false, onToggle: branchDisclosure?.onToggle }), _jsx(SessionStatusMarkers, { pill: pill, StatusIcon: StatusIcon, hasInterruptedRun: hasInterruptedRun }), _jsx(SessionGitBadge, { session: session }), _jsx(SessionTitleButton, { isActive: isActive, session: session, sessionId: sessionId, onSelect: actions.select }), _jsx(SessionActionsTrigger, { menuOpen: menuOpen, session: session, onClick: handleActionsClick }), _jsx(SessionItemContextMenu, { open: menuOpen, position: menuPos, sessionId: sessionId, onClose: () => setMenuOpen(false), onMarkUnread: actions.markUnread, onClone: actions.clone, onArchive: actions.archive, onDelete: actions.delete })] }));
}

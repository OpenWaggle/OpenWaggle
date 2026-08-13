import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
const ENV_MODE_LABELS = {
    local: 'Current checkout',
    worktree: 'New worktree',
};
const NOTICE_ACTION_CLASS = 'shrink-0 whitespace-nowrap rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-hover';
function toEnvMode(value) {
    return value === 'worktree' ? 'worktree' : 'local';
}
/**
 * Left half of the composer context row (WS1b): where the next send will run.
 *
 * This owns only the environment mode. The ref it runs on is owned by the single
 * run-target picker on the right of the same row, so no branch string is shown
 * twice. Deliberately one fixed-height row that never grows — rendering worktree
 * options inline used to stack the row and shift the composer on every mode change.
 */
/**
 * A vanished worktree stops the send and offers the two ways out, rather than the
 * agent silently receiving a fresh empty tree while the session's earlier work is
 * gone. Recreate reattaches the session's own branch; switching runs in the opened
 * checkout, which is a real change of isolation and is recorded on the session.
 */
function MissingWorktreeNotice({ reason, strip, }) {
    return (_jsxs("div", { role: "alert", className: "flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5", children: [_jsx("span", { className: "text-status-error", children: reason }), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => void strip.recreateWorktree(), className: NOTICE_ACTION_CLASS, children: "Recreate worktree" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: strip.switchToLocalMode, className: NOTICE_ACTION_CLASS, children: "Use current checkout" })] }));
}
export function SessionContextRow({ strip }) {
    if (!strip.visible)
        return null;
    /*
     * A vanished worktree replaces the compact mode row rather than squeezing into it:
     * the message and its two actions need the full width, and "Use current checkout"
     * already IS the switch to local mode, so a mode dropdown beside it duplicates it.
     */
    if (strip.sendPlan.kind === 'worktree-missing') {
        return _jsx(MissingWorktreeNotice, { reason: strip.sendPlan.reason, strip: strip });
    }
    return (_jsxs("div", { className: "flex min-w-0 items-center gap-1.5 text-[12px] text-text-tertiary", children: [_jsx("span", { className: "shrink-0", children: "Run in" }), _jsx(Select, { "aria-label": "Session environment mode", value: strip.envMode, onChange: (event) => strip.setEnvMode(toEnvMode(event.target.value)), selectSize: "xs", children: SESSION_ENVIRONMENT_MODES.map((mode) => (_jsx("option", { value: mode, children: ENV_MODE_LABELS[mode] }, mode))) }), strip.sendPlan.kind === 'blocked' ? (_jsx("span", { role: "alert", className: "min-w-0 truncate text-status-error", children: strip.sendPlan.reason })) : null] }));
}

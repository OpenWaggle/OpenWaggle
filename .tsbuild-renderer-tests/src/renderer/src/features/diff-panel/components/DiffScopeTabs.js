import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
const AUTOMATIC_VALUE = '';
/**
 * Diff scope selector (WS6): switch between the working-tree diff, a branch diff
 * against a base ref (combobox with an "Automatic" default + branch choices),
 * and per-turn Turn diffs. The Turns tab appears only when the session has
 * captured Turn checkpoints.
 */
export function DiffScopeTabs({ selection, baseRef, baseRefChoices, turns, onSelectScope, onChangeBaseRef, onSelectTurn, }) {
    const selectedTurnId = selection.kind === 'turn' ? selection.turnId : '';
    return (_jsxs("div", { className: "flex items-center gap-2 h-9 px-4 border-b border-border shrink-0", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: () => onSelectScope('unstaged'), className: tabClass(selection.kind === 'unstaged'), children: "Working tree" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => onSelectScope('branch'), className: tabClass(selection.kind === 'branch'), children: "Branch" }), turns.length > 0 ? (_jsx(Button, { variant: "unstyled", type: "button", onClick: () => onSelectScope('turn'), className: tabClass(selection.kind === 'turn'), children: "Turns" })) : null, selection.kind === 'branch' ? (_jsxs(Select, { "aria-label": "Branch diff base ref", value: baseRef ?? AUTOMATIC_VALUE, onChange: (event) => onChangeBaseRef(event.target.value), className: "ml-1 max-w-[240px]", children: [_jsx("option", { value: AUTOMATIC_VALUE, children: "Automatic" }), baseRefChoices.map((choice) => (_jsx("option", { value: choice.label, children: choice.label }, choice.id)))] })) : null, selection.kind === 'turn' ? (_jsx(Select, { "aria-label": "Turn", value: selectedTurnId, onChange: (event) => onSelectTurn(event.target.value), className: "ml-1 max-w-[240px]", children: turns.map((turn) => (_jsx("option", { value: turn.turnId, children: `Turn ${String(turn.turnIndex + 1)} (+${String(turn.insertions)} −${String(turn.deletions)})` }, turn.turnId))) })) : null] }));
}
function tabClass(active) {
    return `h-[24px] px-2 rounded-[5px] text-[12px] ${active ? 'bg-diff-stage-bg text-accent font-medium' : 'text-text-tertiary hover:bg-bg-hover'}`;
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDiffViewOptions } from '../hooks/useDiffViewOptions';
import { DiffScopeTabs } from './DiffScopeTabs';
import { DiffViewToolbar } from './DiffViewToolbar';
/** Scope tabs plus the diff view controls. */
export function DiffPanelHeader({ selection, baseRef, baseRefChoices, turns, onSelectScope, onChangeBaseRef, onSelectTurn, }) {
    const { viewOptions, setDiffView, toggleWrapLines } = useDiffViewOptions();
    return (_jsxs("div", { className: "flex items-center gap-2 pr-2", children: [_jsx("div", { className: "min-w-0 flex-1", children: _jsx(DiffScopeTabs, { selection: selection, baseRef: baseRef, baseRefChoices: baseRefChoices, turns: turns, onSelectScope: onSelectScope, onChangeBaseRef: onChangeBaseRef, onSelectTurn: onSelectTurn }) }), _jsx(DiffViewToolbar, { viewOptions: viewOptions, onSetDiffView: setDiffView, onToggleWrapLines: toggleWrapLines })] }));
}

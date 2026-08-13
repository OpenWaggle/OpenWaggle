import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ScrollToBottomButton } from '@/features/chat/components';
import { SessionTreeRows } from './SessionTreeRows';
function EmptySessionTreeMessage({ searchActive }) {
    return (_jsx("div", { className: "px-2 py-6 text-center text-[12px] text-text-tertiary", children: searchActive ? 'No nodes match this search.' : 'No nodes match this filter.' }));
}
export function SessionTreePanelContent({ content }) {
    const { onScrollToTreeBottom, onTreeScroll, rowActions, rowRefs: rowElements, scrollContainerRef: scrollContainer, searchActive, showTreeScrollToBottom, tree, treeRowsRef: treeRows, view, } = content;
    return (_jsxs("div", { className: "relative min-h-0 flex-1", children: [_jsx("div", { ref: scrollContainer, className: "h-full overflow-y-auto p-2", onScroll: onTreeScroll, children: !tree ? (_jsx("div", { className: "px-2 py-6 text-center text-[12px] text-text-tertiary", children: "No session tree yet." })) : view?.visibleRows.length === 0 ? (_jsx(EmptySessionTreeMessage, { searchActive: searchActive })) : view ? (_jsx("div", { ref: treeRows, children: _jsx(SessionTreeRows, { actions: rowActions, refs: { rowRefs: rowElements }, view: view }) })) : null }), _jsx(ScrollToBottomButton, { visible: showTreeScrollToBottom, onClick: onScrollToTreeBottom })] }));
}

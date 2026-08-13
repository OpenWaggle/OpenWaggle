import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSessionTreePanelController } from '../hooks/useSessionTreePanelController';
import { SessionTreePanelContent } from './SessionTreePanelContent';
import { SessionTreePanelFilters } from './SessionTreePanelFilters';
import { SessionTreePanelHeader } from './SessionTreePanelHeader';
export function SessionTreePanel({ onClose }) {
    const panel = useSessionTreePanelController(onClose);
    return (_jsxs("section", { className: "flex h-full min-w-0 flex-col bg-diff-bg", "aria-label": "Session Tree", children: [_jsx(SessionTreePanelHeader, { onClose: panel.header.onClose }), _jsx(SessionTreePanelFilters, { filters: panel.filters }), _jsx(SessionTreePanelContent, { content: panel.content })] }));
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useBackgroundRunMonitor } from '@/features/chat/hooks';
import { FeedbackModal } from '@/features/feedback/components';
import { Sidebar } from '@/features/sidebar/components';
import { Header } from '@/shell/Header';
import { ToastOverlay } from '@/shell/ToastOverlay';
import { useUIStore } from '@/shell/ui-store';
import { useAutoUpdater } from '@/shell/useAutoUpdater';
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle';
import { WorkspaceTerminal } from './WorkspaceTerminal';
export function WorkspaceShell({ children }) {
    useWorkspaceLifecycle();
    useBackgroundRunMonitor();
    useAutoUpdater();
    const feedbackModalOpen = useUIStore((s) => s.feedbackModalOpen);
    return (_jsxs("div", { className: "flex size-full overflow-hidden bg-bg", children: [_jsx(Sidebar, {}), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col overflow-hidden", children: [_jsx(Header, {}), children, _jsx(WorkspaceTerminal, {})] }), _jsx(ToastOverlay, {}), feedbackModalOpen && _jsx(FeedbackModal, {})] }));
}

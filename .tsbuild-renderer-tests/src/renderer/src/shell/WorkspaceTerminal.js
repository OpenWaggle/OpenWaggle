import { jsx as _jsx } from "react/jsx-runtime";
import { useProject } from '@/features/sessions/hooks';
import { TerminalPanel } from '@/features/terminal/components';
import { cn } from '@/shared/lib/cn';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { useUIStore } from '@/shell/ui-store';
export function WorkspaceTerminal() {
    const terminalOpen = useUIStore((s) => s.terminalOpen);
    const closeTerminal = useUIStore((s) => s.closeTerminal);
    const { projectPath } = useProject();
    return (_jsx("div", { className: cn('overflow-hidden transition-[height] duration-200 ease-out', terminalOpen ? 'h-[228px]' : 'h-0'), children: terminalOpen && (_jsx(PanelErrorBoundary, { name: "Terminal", children: _jsx(TerminalPanel, { projectPath: projectPath, onClose: closeTerminal }) })) }));
}

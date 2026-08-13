import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { match } from '@diegogbrisa/ts-match';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useChat } from '@/features/chat/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { useFullscreen } from '@/shell/useFullscreen';
import { SettingsNav } from './SettingsNav';
import { AppearanceSection } from './sections/AppearanceSection';
import { ArchivedSection } from './sections/ArchivedSection';
import { ConnectionsSection } from './sections/ConnectionsSection';
import { ExtensionsSection } from './sections/ExtensionsSection';
import { GeneralSection } from './sections/GeneralSection';
import { McpSection } from './sections/McpSection';
import { WaggleSection } from './sections/WaggleSection';
import { WorktreesSection } from './sections/WorktreesSection';
export function SettingsPage({ activeTab }) {
    const navigate = useNavigate();
    const { activeSessionId } = useChat();
    const isFullscreen = useFullscreen();
    function navigateBackToApp() {
        if (activeSessionId) {
            void navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: String(activeSessionId) },
            });
            return;
        }
        void navigate({ to: '/' });
    }
    return (_jsxs("div", { className: "flex size-full flex-col bg-bg", children: [_jsxs("div", { className: cn('drag-region flex shrink-0 items-center gap-3 border-b border-border px-4 h-12', !isFullscreen && 'pl-[80px]'), children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: navigateBackToApp, className: "no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors", children: [_jsx(ArrowLeft, { className: "size-4" }), _jsx("span", { className: "text-[13px]", children: "Back to app" })] }), _jsx("span", { className: "no-drag text-[15px] font-medium text-text-primary", children: "Settings" })] }), _jsxs("div", { className: "flex flex-1 overflow-hidden", children: [_jsx(SettingsNav, { activeTab: activeTab }), _jsx("div", { className: "flex-1 overflow-y-auto px-10 py-8", children: _jsx(SettingsTabContent, { tab: activeTab }) })] })] }));
}
function SettingsTabContent({ tab }) {
    return match(tab)
        .with('general', () => _jsx(GeneralSection, {}))
        .with('appearance', () => _jsx(AppearanceSection, {}))
        .with('waggle', () => _jsx(WaggleSection, {}))
        .with('extensions', () => _jsx(ExtensionsSection, {}))
        .with('mcp', () => _jsx(McpSection, {}))
        .with('worktrees', () => _jsx(WorktreesSection, {}))
        .with('connections', () => _jsx(ConnectionsSection, {}))
        .with('archived', () => _jsx(ArchivedSection, {}))
        .otherwise(() => _jsx(GeneralSection, {}));
}

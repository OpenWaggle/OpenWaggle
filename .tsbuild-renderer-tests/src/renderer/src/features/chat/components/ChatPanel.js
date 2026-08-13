import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { useChatPanelSections } from '../hooks/use-chat-panel-controller';
import { AgentInteractionsPanel } from './AgentInteractionsPanel';
import { ChatComposerStack } from './ChatComposerStack';
import { ChatTranscript } from './ChatTranscript';
export function ChatPanelContent({ sections, onOpenSessionTree }) {
    return (_jsx("div", { className: "flex size-full overflow-hidden", children: _jsxs("div", { className: "flex min-w-0 flex-1 flex-col overflow-hidden bg-bg", "data-chat-panel-main": "true", children: [_jsx(PanelErrorBoundary, { name: "Chat transcript", className: "flex flex-1 flex-col overflow-hidden", children: _jsx(ChatTranscript, { section: sections.transcript }) }), _jsxs(PanelErrorBoundary, { name: "Composer", children: [_jsx(AgentInteractionsPanel, { interactions: sections.agentInteractions, extensionRegistry: sections.extensionRegistry, extensionProjectPaths: sections.extensionProjectPaths, onRespond: sections.onRespondAgentInteraction }), _jsx(ChatComposerStack, { agentInteractions: sections.agentInteractions, extensionProjectPaths: sections.extensionProjectPaths, extensionRegistry: sections.extensionRegistry, onRespondAgentInteraction: sections.onRespondAgentInteraction, section: sections.composer, onOpenSessionTree: onOpenSessionTree })] })] }) }));
}
export function ChatPanel() {
    const sections = useChatPanelSections();
    return _jsx(ChatPanelContent, { sections: sections });
}

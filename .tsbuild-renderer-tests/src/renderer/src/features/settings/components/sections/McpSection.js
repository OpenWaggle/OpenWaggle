import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMcpSectionController } from '@/features/settings/hooks/useMcpSectionController';
import { usePreferences } from '@/features/settings/hooks/useSettings';
import { McpAdapterCard, McpErrorAlert, McpSectionHeading, McpServersPanel, McpSourcesPanel, } from './McpSectionPanels';
import { McpSourceEditor } from './McpSourceEditor';
export function McpSection() {
    const { settings } = usePreferences();
    const controller = useMcpSectionController(settings.projectPath);
    const sources = controller.view?.sources ?? [];
    const servers = controller.view?.servers ?? [];
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(McpSectionHeading, {}), _jsx(McpErrorAlert, { message: controller.error }), _jsx(McpErrorAlert, { message: controller.view?.adapter.lastError }), _jsx(McpAdapterCard, { view: controller.view, busy: controller.busy, onRefresh: () => void controller.refresh(), onToggle: () => void controller.toggleAdapter() }), _jsx(McpSourcesPanel, { sources: sources, selectedSource: controller.selectedSource, onSelectSource: controller.selectSource }), _jsx(McpServersPanel, { servers: servers, busy: controller.busy, onToggleServer: (server) => void controller.toggleServer(server) }), _jsx(McpSourceEditor, { selectedSource: controller.selectedSource, rawJson: controller.rawJson, busy: controller.busy, onSave: () => void controller.saveSelectedSource(), onRawJsonChange: controller.updateRawJson })] }));
}

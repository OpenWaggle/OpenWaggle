import type { McpConfigSourceId, McpConfigSourceSummary, McpServerSummary, McpSettingsView } from '@shared/types/mcp';
export declare function useMcpSectionController(projectPath: string | null): {
    view: McpSettingsView | null;
    error: string | null;
    selectedSource: McpConfigSourceSummary | null;
    rawJson: string;
    busy: boolean;
    refresh: () => Promise<void>;
    toggleAdapter: () => Promise<void>;
    toggleServer: (server: McpServerSummary) => Promise<void>;
    saveSelectedSource: () => Promise<void>;
    selectSource: (sourceId: McpConfigSourceId) => void;
    updateRawJson: (sourceId: McpConfigSourceId, rawJson: string) => void;
};

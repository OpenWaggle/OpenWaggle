import type { McpConfigSourceId, McpConfigSourceSummary, McpServerSummary, McpSettingsView } from '@shared/types/mcp';
export declare function McpSectionHeading(): import("node_modules/@types/react").JSX.Element;
export declare function McpErrorAlert({ message }: {
    readonly message: string | null | undefined;
}): import("node_modules/@types/react").JSX.Element | null;
export declare function McpAdapterCard({ view, busy, onRefresh, onToggle, }: {
    readonly view: McpSettingsView | null;
    readonly busy: boolean;
    readonly onRefresh: () => void;
    readonly onToggle: () => void;
}): import("node_modules/@types/react").JSX.Element;
export declare function McpSourcesPanel({ sources, selectedSource, onSelectSource, }: {
    readonly sources: readonly McpConfigSourceSummary[];
    readonly selectedSource: McpConfigSourceSummary | null;
    readonly onSelectSource: (sourceId: McpConfigSourceId) => void;
}): import("node_modules/@types/react").JSX.Element;
export declare function McpServersPanel({ servers, busy, onToggleServer, }: {
    readonly servers: readonly McpServerSummary[];
    readonly busy: boolean;
    readonly onToggleServer: (server: McpServerSummary) => void;
}): import("node_modules/@types/react").JSX.Element;

import type { McpConfigSourceId, McpConfigSourceSummary } from '@shared/types/mcp';
interface McpSourceEditorProps {
    readonly selectedSource: McpConfigSourceSummary | null;
    readonly rawJson: string;
    readonly busy: boolean;
    readonly onSave: () => void;
    readonly onRawJsonChange: (sourceId: McpConfigSourceId, rawJson: string) => void;
}
export declare function McpSourceEditor({ selectedSource, rawJson, busy, onSave, onRawJsonChange, }: McpSourceEditorProps): import("node_modules/@types/react").JSX.Element;
export {};

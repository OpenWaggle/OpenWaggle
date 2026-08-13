import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block';
import type { ToolCallViewModel } from './ToolCallBlock';
interface ToolCallHeaderProps {
    readonly expanded: boolean;
    readonly duration: number;
    readonly result: ToolCallResultPayload | undefined;
    readonly view: ToolCallViewModel;
    readonly onBranchFromMessage?: (messageId: string) => void;
    readonly onToggleExpanded: () => void;
}
export declare function ToolCallHeader({ expanded, duration, result, view, onBranchFromMessage, onToggleExpanded, }: ToolCallHeaderProps): import("node_modules/@types/react").JSX.Element;
export declare function CollapsedToolPreview({ view, expanded, }: {
    readonly view: ToolCallViewModel;
    readonly expanded: boolean;
}): import("node_modules/@types/react").JSX.Element | null;
export {};

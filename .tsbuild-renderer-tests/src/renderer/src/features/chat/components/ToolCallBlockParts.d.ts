import type { JsonObject } from '@shared/types/json';
import { type UnifiedDiffData } from '@/features/chat/lib/tool-call-block';
export declare function CopyButton({ label, value }: {
    readonly label: string;
    readonly value: string;
}): import("node_modules/@types/react").JSX.Element | null;
export declare function ToolArgs({ name, args, rawArgs, path, }: {
    name: string;
    args: JsonObject;
    rawArgs: string;
    path: string | null;
}): import("node_modules/@types/react").JSX.Element;
export declare function ToolResult({ content, isError, name, path, }: {
    content: unknown;
    isError: boolean;
    name: string;
    path: string | null;
}): import("node_modules/@types/react").JSX.Element;
export declare function UnifiedDiffView({ diff, compact, }: {
    readonly diff: UnifiedDiffData;
    readonly compact?: boolean;
}): import("node_modules/@types/react").JSX.Element;

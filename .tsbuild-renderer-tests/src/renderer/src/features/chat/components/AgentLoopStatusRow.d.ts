import type { ChatRow } from '../lib/types-chat-row';
import type { ChatRowRenderContext } from './ChatRowRenderContext';
export declare function StatusRow({ row, extensions, }: {
    readonly row: Extract<ChatRow, {
        readonly type: 'phase-indicator' | 'run-summary';
    }>;
    readonly extensions: ChatRowRenderContext['extensions'];
}): import("node_modules/@types/react").JSX.Element;

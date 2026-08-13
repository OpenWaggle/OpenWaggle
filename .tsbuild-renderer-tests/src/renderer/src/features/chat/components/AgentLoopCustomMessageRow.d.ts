import type { ChatRow } from '../lib/types-chat-row';
import type { ChatRowRenderContext } from './ChatRowRenderContext';
export declare function CustomMessageRow({ row, extensions, }: {
    readonly row: Extract<ChatRow, {
        readonly type: 'agent-loop-custom-message';
    }>;
    readonly extensions: ChatRowRenderContext['extensions'];
}): import("node_modules/@types/react").JSX.Element;

import type { AgentTransportInteractionRequestEvent, AgentTransportInteractionResolvedEvent } from '@shared/types/stream';
import type { ChatRowRenderContext } from './ChatRowRenderContext';
export declare function InteractionEventRow({ event, extensions, }: {
    readonly event: AgentTransportInteractionRequestEvent | AgentTransportInteractionResolvedEvent;
    readonly extensions: ChatRowRenderContext['extensions'];
}): import("node_modules/@types/react").JSX.Element;

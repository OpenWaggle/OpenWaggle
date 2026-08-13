import type { SessionId } from '@shared/types/brand';
interface QueuedMessagesProps {
    readonly sessionId: SessionId | null;
    readonly onSteer: (messageId: string) => Promise<void>;
    readonly isStreaming: boolean;
    readonly isCompacting?: boolean;
}
/**
 * Queued messages panel that docks above the Composer.
 *
 * The Composer fills 100% of the parent container. The queue stays inset just
 * inside the composer's rounded shoulders so it reads like a docked tab rather
 * than a separate full-width panel.
 */
export declare function QueuedMessages({ sessionId, onSteer, isStreaming, isCompacting, }: QueuedMessagesProps): import("node_modules/@types/react").JSX.Element | null;
export {};

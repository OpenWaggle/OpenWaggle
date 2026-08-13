import type { SessionId } from '@shared/types/brand';
interface CollaborationStatusProps {
    currentSessionId: SessionId | null;
    onStop: () => void;
}
export declare function WaggleCollaborationStatus({ currentSessionId, onStop }: CollaborationStatusProps): import("node_modules/@types/react").JSX.Element | null;
export {};

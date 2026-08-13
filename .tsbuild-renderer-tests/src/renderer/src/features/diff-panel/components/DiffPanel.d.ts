import type { SessionId } from '@shared/types/brand';
interface DiffPanelProps {
    workingPath: string | null;
    sessionId?: SessionId | null;
    onSendMessage: (content: string) => void;
}
export declare function DiffPanel({ workingPath, sessionId, onSendMessage }: DiffPanelProps): import("node_modules/@types/react").JSX.Element;
export {};

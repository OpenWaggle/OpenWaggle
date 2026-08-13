import type { SessionId } from '@shared/types/brand';
interface DiffPanelProps {
    projectPath: string | null;
    sessionId?: SessionId | null;
    onSendMessage: (content: string) => void;
}
export declare function DiffPanel({ projectPath, sessionId, onSendMessage }: DiffPanelProps): import("node_modules/@types/react").JSX.Element;
export {};

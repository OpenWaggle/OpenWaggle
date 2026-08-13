import type { AgentSendPayload } from '@shared/types/agent';
interface ComposerProps {
    onSend: (payload: AgentSendPayload) => Promise<void> | void;
    onEnqueue: (payload: AgentSendPayload) => Promise<void> | void;
    onCancel: () => void;
    isLoading: boolean;
    mode?: {
        readonly disabled?: boolean;
        readonly placeholder?: string;
        readonly sendTitle?: string;
        readonly requiresText?: boolean;
        readonly clearOnSubmit?: boolean;
        readonly recordHistory?: boolean;
        readonly allowEnqueue?: boolean;
    };
    onToast?: (message: string) => void;
}
export declare function Composer({ onSend, onEnqueue, onCancel, isLoading, mode, onToast }: ComposerProps): import("node_modules/@types/react").JSX.Element;
export {};

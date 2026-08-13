import type { SessionForkTarget } from '../lib/session-fork-targets';
interface SessionForkSelectorProps {
    readonly open: boolean;
    readonly targets: readonly SessionForkTarget[];
    readonly onSelect: (target: SessionForkTarget) => void;
    readonly onClose: () => void;
}
export declare function SessionForkSelector({ open, targets, onSelect, onClose, }: SessionForkSelectorProps): import("node_modules/@types/react").JSX.Element | null;
export {};

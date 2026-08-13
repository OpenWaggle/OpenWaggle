import type { SessionId } from '@shared/types/brand';
interface SessionItemContextMenuProps {
    readonly open: boolean;
    readonly position: {
        readonly x: number;
        readonly y: number;
    };
    readonly sessionId: SessionId;
    readonly onClose: () => void;
    readonly onMarkUnread: (id: SessionId) => void;
    readonly onClone: (id: SessionId) => void;
    readonly onArchive: (id: SessionId) => void;
    readonly onDelete: (id: SessionId) => void;
}
export declare function SessionItemContextMenu({ open, position, sessionId, onClose, onMarkUnread, onClone, onArchive, onDelete, }: SessionItemContextMenuProps): import("node_modules/@types/react").JSX.Element;
export {};

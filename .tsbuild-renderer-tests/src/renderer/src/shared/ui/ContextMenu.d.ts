interface ContextMenuProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly position: {
        readonly x: number;
        readonly y: number;
    };
    readonly children: React.ReactNode;
}
export declare function ContextMenu({ open, onClose, position, children }: ContextMenuProps): import("node_modules/@types/react").ReactPortal | null;
export {};

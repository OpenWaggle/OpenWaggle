interface UsePopoverOptions {
    onClose?: () => void;
    /** Override the click-outside guard (useful for controlled mode). */
    isActive?: boolean;
}
interface UsePopoverReturn {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    toggle: () => void;
    containerRef: React.RefObject<HTMLDivElement | null>;
}
export declare function usePopover(options?: UsePopoverOptions): UsePopoverReturn;
export {};

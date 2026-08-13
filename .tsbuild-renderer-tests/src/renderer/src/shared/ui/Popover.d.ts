type Placement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
interface PopoverProps {
    /** The trigger element. A ReactNode renders as-is; a render function receives popover state. */
    trigger: React.ReactNode | ((state: {
        isOpen: boolean;
        toggle: () => void;
    }) => React.ReactNode);
    /** Dropdown content rendered when open. */
    children: React.ReactNode;
    /** Controlled open state. When provided, the component is fully controlled. */
    open?: boolean;
    /** Called when the popover wants to change its open state (controlled mode). */
    onOpenChange?: (open: boolean) => void;
    /** Dropdown placement relative to the trigger. */
    placement?: Placement;
    /** Additional classes for the dropdown panel. */
    className?: string;
}
export declare function Popover({ trigger, children, open: controlledOpen, onOpenChange, placement, className, }: PopoverProps): import("node_modules/@types/react").JSX.Element;
export {};

interface ModalDialogProps {
    /** Accessible name. Omit when `labelledBy` points at a visible heading. */
    readonly label?: string;
    /** Id of a visible heading that names the dialog (preferred over `label`). */
    readonly labelledBy?: string;
    /** Invoked on Escape, backdrop dismissal, and any native close. */
    readonly onClose: () => void;
    /** Classes for the dialog panel itself. */
    readonly className?: string;
    readonly children: React.ReactNode;
}
/**
 * Modal built on the native `<dialog>` element, which provides focus trapping,
 * Escape-to-close, top-layer stacking, and inert background content for free —
 * none of which a `role="dialog"` div gets (react-doctor/prefer-html-dialog).
 *
 * Mount it only while the modal should be shown; it opens on mount.
 */
export declare function ModalDialog({ label, labelledBy, onClose, className, children }: ModalDialogProps): import("node_modules/@types/react").JSX.Element;
export {};

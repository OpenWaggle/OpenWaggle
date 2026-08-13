import type { ActionDialogConfig } from '../lib/action-dialog-config';
interface ActionDialogFooterProps {
    readonly config: ActionDialogConfig;
    readonly busy: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
}
export declare function ActionDialogFooter({ config, busy, onCancel, onConfirm }: ActionDialogFooterProps): import("node_modules/@types/react").JSX.Element;
export {};

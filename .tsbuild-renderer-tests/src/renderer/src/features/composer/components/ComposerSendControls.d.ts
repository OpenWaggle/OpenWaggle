interface ComposerSendControlsProps {
    readonly isLoading: boolean;
    readonly canSend: boolean;
    readonly sendTitle?: string;
    readonly onSend: () => void;
    readonly onCancel: () => void;
}
export declare function ComposerSendControls({ isLoading, canSend, sendTitle, onSend, onCancel, }: ComposerSendControlsProps): import("node_modules/@types/react").JSX.Element;
export {};

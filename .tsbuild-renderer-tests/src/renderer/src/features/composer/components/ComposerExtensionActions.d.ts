export interface ComposerExtensionActionLauncher {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly badge: string;
    readonly onOpen: () => void;
}
interface ComposerExtensionActionsProps {
    readonly launchers: readonly ComposerExtensionActionLauncher[];
}
export declare function ComposerExtensionActions({ launchers }: ComposerExtensionActionsProps): import("node_modules/@types/react").JSX.Element | null;
export {};

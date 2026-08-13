interface ComposerAlert {
    id: string;
    message: string;
    onDismiss?: () => void;
}
interface ComposerAlertsProps {
    alerts: readonly ComposerAlert[];
}
export declare function ComposerAlerts({ alerts }: ComposerAlertsProps): import("node_modules/@types/react").JSX.Element | null;
export {};

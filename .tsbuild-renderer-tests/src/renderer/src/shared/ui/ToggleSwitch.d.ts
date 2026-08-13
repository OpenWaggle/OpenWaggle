type ToggleSwitchSize = 'compact' | 'default';
interface ToggleSwitchProps {
    readonly checked: boolean;
    readonly onCheckedChange: (checked: boolean) => void;
    readonly label: string;
    readonly disabled?: boolean;
    readonly className?: string;
    readonly size?: ToggleSwitchSize;
    readonly stopPropagation?: boolean;
}
export declare function ToggleSwitch({ checked, onCheckedChange, label, disabled, className, size, stopPropagation, }: ToggleSwitchProps): import("node_modules/@types/react").JSX.Element;
export {};

import type { RefObject } from 'react';
interface ActionDialogInputProps {
    readonly inputRef: RefObject<HTMLInputElement | null>;
    readonly value: string;
    readonly placeholder: string | undefined;
    readonly onValueChange: (value: string) => void;
    readonly onConfirm: () => void;
}
export declare function ActionDialogInput({ inputRef, value, placeholder, onValueChange, onConfirm, }: ActionDialogInputProps): import("node_modules/@types/react").JSX.Element | null;
export {};

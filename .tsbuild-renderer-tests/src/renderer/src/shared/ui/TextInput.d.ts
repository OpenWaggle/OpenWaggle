import type { InputHTMLAttributes, Ref } from 'react';
type TextInputVariant = 'default' | 'transparent';
type TextInputSize = 'sm' | 'md';
interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
    readonly ref?: Ref<HTMLInputElement>;
    readonly variant?: TextInputVariant;
    readonly inputSize?: TextInputSize;
    readonly monospace?: boolean;
}
/**
 * Shared text-like input primitive for visible user-editable fields.
 * Hidden/file inputs remain feature-specific because they are behavioral
 * capabilities, not styled UI controls.
 */
export declare function TextInput({ ref, variant, inputSize, monospace, className, ...props }: TextInputProps): import("node_modules/@types/react").JSX.Element;
export {};

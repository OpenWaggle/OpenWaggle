import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost' | 'subtle' | 'row' | 'link' | 'unstyled';
type ButtonSize = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon-md' | 'icon-lg';
type ButtonRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';
type ButtonAlign = 'center' | 'start' | 'between';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    readonly ref?: Ref<HTMLButtonElement>;
    readonly variant?: ButtonVariant;
    readonly size?: ButtonSize;
    readonly radius?: ButtonRadius;
    readonly align?: ButtonAlign;
    readonly fullWidth?: boolean;
    readonly leftIcon?: ReactNode;
    readonly rightIcon?: ReactNode;
}
/**
 * Shared renderer button primitive.
 *
 * Every app-level button should flow through this component so disabled,
 * focus, spacing, and tone conventions stay consistent. `unstyled` exists
 * for specialized surfaces that need exact layout control, but still keeps
 * button semantics centralized.
 */
export declare function Button({ ref, variant, size, radius, align, fullWidth, type, className, leftIcon, rightIcon, children, ...props }: ButtonProps): import("node_modules/@types/react").JSX.Element;
export {};

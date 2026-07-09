# @openwaggle/extension-react

Package path: `packages/extension-react`

## Export `.`

Types: `dist/index.d.ts`

### Declarations from `dist/index.d.ts`

```ts
import { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, type OpenWaggleExtensionUiButtonVariant, type OpenWaggleExtensionUiTone } from '@openwaggle/extension-sdk';
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
export interface StackProps {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly gap?: CSSProperties['gap'];
    readonly ref?: Ref<HTMLDivElement>;
    readonly style?: CSSProperties;
}
export declare function Stack({ children, className, gap, ref, style }: StackProps): import("react").JSX.Element;
export interface PanelProps {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly ref?: Ref<HTMLDivElement>;
    readonly style?: CSSProperties;
}
export declare function Panel({ children, className, ref, style }: PanelProps): import("react").JSX.Element;
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    readonly ref?: Ref<HTMLButtonElement>;
    readonly variant?: OpenWaggleExtensionUiButtonVariant;
}
export declare function Button({ children, className, ref, variant, ...props }: ButtonProps): import("react").JSX.Element;
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    readonly ref?: Ref<HTMLInputElement>;
}
export declare function Input({ className, ref, ...props }: InputProps): import("react").JSX.Element;
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    readonly ref?: Ref<HTMLTextAreaElement>;
}
export declare function Textarea({ className, ref, ...props }: TextareaProps): import("react").JSX.Element;
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    readonly ref?: Ref<HTMLSelectElement>;
}
export declare function Select({ children, className, ref, ...props }: SelectProps): import("react").JSX.Element;
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    readonly ref?: Ref<HTMLInputElement>;
}
export declare function Checkbox({ className, ref, ...props }: CheckboxProps): import("react").JSX.Element;
export interface BadgeProps {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly ref?: Ref<HTMLSpanElement>;
    readonly tone?: OpenWaggleExtensionUiTone;
}
export declare function Badge({ children, className, ref, tone }: BadgeProps): import("react").JSX.Element;
export interface AlertProps {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly ref?: Ref<HTMLDivElement>;
    readonly role?: 'alert' | 'status' | 'note';
    readonly tone?: OpenWaggleExtensionUiTone;
}
export declare function Alert({ children, className, ref, role, tone }: AlertProps): import("react").JSX.Element;
export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
    readonly description?: ReactNode;
    readonly error?: ReactNode;
    readonly htmlFor?: string;
    readonly label: ReactNode;
    readonly ref?: Ref<HTMLDivElement>;
}
export declare function Field({ children, className, description, error, htmlFor, label, ref, ...props }: FieldProps): import("react").JSX.Element;
export type { OpenWaggleExtensionUiButtonVariant, OpenWaggleExtensionUiTone };
export { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES };
```

## Export `./styles.css`

Types: none

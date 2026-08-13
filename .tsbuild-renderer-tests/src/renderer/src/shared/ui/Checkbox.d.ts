import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    readonly ref?: Ref<HTMLInputElement>;
    readonly label?: ReactNode;
    readonly labelClassName?: string;
}
export declare function Checkbox({ ref, label, labelClassName, className, ...props }: CheckboxProps): import("node_modules/@types/react").JSX.Element;
export {};

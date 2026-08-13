import type { InputHTMLAttributes, Ref } from 'react';
interface RangeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
    readonly ref?: Ref<HTMLInputElement>;
}
export declare function RangeInput({ ref, className, ...props }: RangeInputProps): import("node_modules/@types/react").JSX.Element;
export {};

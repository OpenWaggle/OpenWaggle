import type { Ref, SelectHTMLAttributes } from 'react';
type SelectSize = 'xs' | 'sm' | 'md';
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
    readonly ref?: Ref<HTMLSelectElement>;
    readonly selectSize?: SelectSize;
}
export declare function Select({ ref, selectSize, className, children, ...props }: SelectProps): import("node_modules/@types/react").JSX.Element;
export {};

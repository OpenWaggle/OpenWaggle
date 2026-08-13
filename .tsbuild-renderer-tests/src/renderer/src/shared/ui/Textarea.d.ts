import type { Ref, TextareaHTMLAttributes } from 'react';
type TextareaVariant = 'default' | 'mono';
type TextareaResize = 'none' | 'vertical' | 'both';
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    readonly ref?: Ref<HTMLTextAreaElement>;
    readonly variant?: TextareaVariant;
    readonly resize?: TextareaResize;
    readonly highlightLanguage?: string;
}
export declare function Textarea({ ref, variant, resize, highlightLanguage, className, value, onScroll, ...props }: TextareaProps): import("node_modules/@types/react").JSX.Element;
export {};

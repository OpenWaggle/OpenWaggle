import type { ReactNode } from 'react';
interface CodeBlockProps {
    children: ReactNode;
    language?: string | undefined;
    className?: string | undefined;
}
export declare function CodeBlock({ children, language, className }: CodeBlockProps): import("node_modules/@types/react").JSX.Element;
export {};

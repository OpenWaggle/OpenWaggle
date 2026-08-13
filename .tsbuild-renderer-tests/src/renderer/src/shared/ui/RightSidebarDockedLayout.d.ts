import type { ReactNode } from 'react';
interface DockedLayoutContent {
    readonly children: ReactNode;
    readonly sidebar: ReactNode;
}
interface DockedLayoutCaptures {
    readonly captureMain: (node: HTMLDivElement | null) => void;
    readonly capturePanel: (node: HTMLDivElement | null) => void;
    readonly captureRoot: (node: HTMLDivElement | null) => void;
}
interface DockedLayoutShell {
    readonly mainMinWidth: number;
    readonly open: boolean;
    readonly shouldRenderSidebar: boolean;
    readonly width: number;
    readonly captureSidebar: (node: HTMLDivElement | null) => void;
}
interface RightSidebarDockedLayoutProps {
    readonly captures: DockedLayoutCaptures;
    readonly content: DockedLayoutContent;
    readonly rail: ReactNode;
    readonly shell: DockedLayoutShell;
}
export declare function RightSidebarDockedLayout({ captures: { captureMain, capturePanel, captureRoot }, content: { children, sidebar }, rail, shell: { captureSidebar, mainMinWidth, open, shouldRenderSidebar, width }, }: RightSidebarDockedLayoutProps): import("node_modules/@types/react").JSX.Element;
export {};

import type { ReactNode } from 'react';
interface RightSidebarSheetProps {
    readonly children: ReactNode;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
}
export declare function RightSidebarSheet({ children, open, onOpenChange }: RightSidebarSheetProps): import("node_modules/@types/react").JSX.Element;
export {};

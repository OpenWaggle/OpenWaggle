import type { ChatPanelSections } from '../model';
interface ChatPanelContentProps {
    readonly sections: ChatPanelSections;
    readonly onOpenSessionTree?: () => void;
}
export declare function ChatPanelContent({ sections, onOpenSessionTree }: ChatPanelContentProps): import("node_modules/@types/react").JSX.Element;
export declare function ChatPanel(): import("node_modules/@types/react").JSX.Element;
export {};

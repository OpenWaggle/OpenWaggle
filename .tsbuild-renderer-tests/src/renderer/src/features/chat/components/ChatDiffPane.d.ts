import type { ChatDiffSectionState } from '../model';
interface ChatDiffPaneProps {
    readonly section: ChatDiffSectionState;
    readonly onClose: () => void;
}
export declare function ChatDiffPane({ section, onClose }: ChatDiffPaneProps): import("node_modules/@types/react").JSX.Element;
export {};

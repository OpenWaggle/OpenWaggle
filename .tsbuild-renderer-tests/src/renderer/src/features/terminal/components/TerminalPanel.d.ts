import '@xterm/xterm/css/xterm.css';
interface TerminalPanelProps {
    projectPath: string | null;
    onClose: () => void;
}
export declare function TerminalPanel({ projectPath, onClose }: TerminalPanelProps): import("node_modules/@types/react").JSX.Element;
export {};

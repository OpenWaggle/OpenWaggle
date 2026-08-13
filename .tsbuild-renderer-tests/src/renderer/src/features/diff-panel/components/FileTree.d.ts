import type { GitFileDiff } from '@shared/types/git';
interface FileTreeProps {
    readonly files: readonly GitFileDiff[];
    readonly onFileClick: (path: string) => void;
}
export declare function FileTree({ files, onFileClick }: FileTreeProps): import("node_modules/@types/react").JSX.Element;
export {};

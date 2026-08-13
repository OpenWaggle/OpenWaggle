import type { SessionContextRowState } from '@/features/git';
interface ComposerBranchRowProps {
    readonly strip: SessionContextRowState | null;
    readonly onToast?: (message: string) => void;
}
export declare function ComposerBranchRow({ strip, onToast }: ComposerBranchRowProps): import("node_modules/@types/react").JSX.Element | null;
export {};

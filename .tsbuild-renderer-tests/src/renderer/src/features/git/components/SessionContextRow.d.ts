import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow';
interface SessionContextRowProps {
    readonly strip: SessionContextRowState;
}
export declare function SessionContextRow({ strip }: SessionContextRowProps): import("node_modules/@types/react").JSX.Element | null;
export {};

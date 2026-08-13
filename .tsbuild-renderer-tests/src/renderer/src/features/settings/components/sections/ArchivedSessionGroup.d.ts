import type { SessionId } from '@shared/types/brand';
import type { ProjectGroup } from '@/features/sidebar/lib';
interface ArchivedSessionGroupProps {
    readonly group: ProjectGroup;
    readonly onRestore: (id: SessionId) => void;
    readonly onDelete: (id: SessionId) => void;
}
export declare function ArchivedSessionGroup({ group, onRestore, onDelete }: ArchivedSessionGroupProps): import("node_modules/@types/react").JSX.Element;
export {};

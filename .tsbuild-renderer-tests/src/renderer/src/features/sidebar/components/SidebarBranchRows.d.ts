import type { SidebarBranchRow } from '../lib/sidebar-branches';
import type { SidebarBranchActions } from '../model';
interface SidebarBranchRowsProps {
    readonly sessionId: string;
    readonly rows: readonly SidebarBranchRow[];
    readonly actions: SidebarBranchActions;
}
export declare function SidebarBranchRows({ sessionId, rows, actions }: SidebarBranchRowsProps): import("node_modules/@types/react").JSX.Element | null;
export {};

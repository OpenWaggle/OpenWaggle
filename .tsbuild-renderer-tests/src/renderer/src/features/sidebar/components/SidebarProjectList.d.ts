import type { SidebarProjectGroups } from '../lib/sidebar-project-groups';
import type { SidebarBranchActions, SidebarProjectActions, SidebarProjectRenderState, SidebarSessionActions } from '../model';
interface SidebarProjectListProps {
    readonly sessionGroups: SidebarProjectGroups;
    readonly renderState: SidebarProjectRenderState;
    readonly displayProjectName: (path: string) => string;
    readonly projectActions: SidebarProjectActions;
    readonly sessionActions: SidebarSessionActions;
    readonly branchActions: SidebarBranchActions;
}
export declare function SidebarProjectList({ sessionGroups, renderState, displayProjectName, projectActions, sessionActions, branchActions, }: SidebarProjectListProps): import("node_modules/@types/react").JSX.Element | import("node_modules/@types/react").JSX.Element[];
export {};

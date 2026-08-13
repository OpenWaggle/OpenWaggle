import type { SidebarProjectGroup } from '../lib/sidebar-project-groups';
import type { SidebarBranchActions, SidebarProjectActions, SidebarProjectRenderState, SidebarSessionActions } from '../model';
interface ProjectGroupSectionProps {
    readonly group: SidebarProjectGroup;
    readonly renderState: SidebarProjectRenderState;
    readonly displayProjectName: (path: string) => string;
    readonly projectActions: SidebarProjectActions;
    readonly sessionActions: SidebarSessionActions;
    readonly branchActions: SidebarBranchActions;
}
export declare function SidebarProjectGroupSection({ group, renderState, displayProjectName, projectActions, sessionActions, branchActions, }: ProjectGroupSectionProps): import("node_modules/@types/react").JSX.Element;
export {};

import type { SidebarProjectGroup } from '../lib/sidebar-project-groups';
import type { SidebarProjectActions } from '../model';
interface ProjectHeaderProps {
    readonly group: SidebarProjectGroup;
    readonly projectLabel: string;
    readonly isCurrentProject: boolean;
    readonly collapsed: boolean;
    readonly actions: SidebarProjectActions;
}
export declare function SidebarProjectHeader({ group, projectLabel, isCurrentProject, collapsed, actions, }: ProjectHeaderProps): import("node_modules/@types/react").JSX.Element;
export {};

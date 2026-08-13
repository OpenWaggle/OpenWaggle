import type { SessionSummary } from '@shared/types/session';
import type { SidebarSessionActions } from '../model';
type SessionListItemVariant = 'project' | 'root';
interface SessionBranchDisclosureState {
    readonly visible: boolean;
    readonly collapsed: boolean;
    readonly onToggle?: (() => void) | undefined;
}
interface SessionListItemProps {
    readonly session: SessionSummary;
    readonly isActive: boolean;
    readonly variant?: SessionListItemVariant;
    readonly actions: SidebarSessionActions;
    readonly branchDisclosure?: SessionBranchDisclosureState;
}
export declare function SessionListItem({ session, isActive, variant, actions, branchDisclosure, }: SessionListItemProps): import("node_modules/@types/react").JSX.Element;
export {};

import type { SidebarSessionSortMode } from '../lib/sidebar-project-groups';
import type { SidebarView } from '../model/sidebar-types';
export declare function SidebarBrandArea({ isFullscreen }: {
    readonly isFullscreen: boolean;
}): import("node_modules/@types/react").JSX.Element;
export declare function SidebarPrimaryActions({ activeView, onNewSession, onOpenSkills, }: {
    readonly activeView: SidebarView;
    readonly onNewSession: () => void;
    readonly onOpenSkills: () => void;
}): import("node_modules/@types/react").JSX.Element;
export declare function SidebarProjectsHeader({ sortMenuOpen, sortMode, onOpenProject, onSetSortMenuOpen, onSetSortMode, }: {
    readonly sortMenuOpen: boolean;
    readonly sortMode: SidebarSessionSortMode;
    readonly onOpenProject: () => void;
    readonly onSetSortMenuOpen: (open: boolean) => void;
    readonly onSetSortMode: (mode: SidebarSessionSortMode) => void;
}): import("node_modules/@types/react").JSX.Element;
export declare function SidebarSettingsButton({ onOpenSettings }: {
    readonly onOpenSettings: () => void;
}): import("node_modules/@types/react").JSX.Element;

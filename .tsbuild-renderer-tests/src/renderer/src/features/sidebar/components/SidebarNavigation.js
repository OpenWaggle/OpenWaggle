import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowDownAZ, Calendar, Check, Clock, Edit3, FolderPlus, LayoutList, Settings, Sparkles, } from 'lucide-react';
import openwaggleLockup from '@/assets/openwaggle-lockup.png';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Popover } from '@/shared/ui/Popover';
import { SIDEBAR_LAYOUT } from '../constants/sidebar-layout';
const SORT_OPTIONS = [
    { value: 'recent', label: 'Recent', icon: Clock },
    { value: 'oldest', label: 'Oldest', icon: Calendar },
    { value: 'name', label: 'Name (A->Z)', icon: ArrowDownAZ },
];
export function SidebarBrandArea({ isFullscreen }) {
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "drag-region shrink-0 transition-[height] duration-200 ease-out", style: { height: isFullscreen ? 0 : SIDEBAR_LAYOUT.DRAG_REGION_HEIGHT } }), _jsx("div", { className: "drag-region flex shrink-0 items-center px-4 py-1", children: _jsx("img", { src: openwaggleLockup, alt: "OpenWaggle", className: "no-drag h-12 w-auto object-contain" }) }), _jsx("div", { className: "shrink-0 transition-[height] duration-200 ease-out", style: {
                    height: isFullscreen
                        ? SIDEBAR_LAYOUT.FULLSCREEN_SPACER_HEIGHT
                        : SIDEBAR_LAYOUT.WINDOWED_SPACER_HEIGHT,
                } })] }));
}
export function SidebarPrimaryActions({ activeView, onNewSession, onOpenSkills, }) {
    return (_jsxs("div", { className: "shrink-0", children: [_jsxs(Button, { variant: "row", size: "none", radius: "none", "aria-label": "New session", onClick: onNewSession, className: "no-drag h-[34px] gap-2 px-3", children: [_jsx(Edit3, { className: "size-3.5 shrink-0 text-text-tertiary" }), _jsx("span", { className: "text-[14px] text-text-secondary", children: "New session" })] }), _jsxs(Button, { variant: activeView === 'skills' ? 'subtle' : 'row', size: "none", radius: "none", "aria-label": "Skills", onClick: onOpenSkills, className: cn('no-drag h-8 gap-2 px-3', activeView === 'skills' && 'text-text-primary'), title: "Open skills", children: [_jsx(Sparkles, { className: "size-3.5 shrink-0 text-text-tertiary" }), _jsx("span", { className: "text-[14px]", children: "Skills" })] })] }));
}
export function SidebarProjectsHeader({ sortMenuOpen, sortMode, onOpenProject, onSetSortMenuOpen, onSetSortMode, }) {
    return (_jsxs("div", { className: "no-drag flex h-[30px] shrink-0 items-center justify-between px-4", children: [_jsx("span", { className: "text-[12px] font-medium text-text-tertiary", children: "Projects" }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Button, { variant: "ghost", size: "icon-xs", radius: "sm", "aria-label": "Open project folder", onClick: onOpenProject, title: "Open project folder", children: _jsx(FolderPlus, { className: "size-[13px]" }) }), _jsx(Popover, { open: sortMenuOpen, onOpenChange: onSetSortMenuOpen, placement: "bottom-end", className: "min-w-[150px] py-1", trigger: _jsx(Button, { variant: "ghost", size: "icon-xs", radius: "sm", "aria-label": "Sort sessions", onClick: () => onSetSortMenuOpen(!sortMenuOpen), className: cn(sortMenuOpen && 'text-text-primary'), title: "Sort sessions", children: _jsx(LayoutList, { className: "size-3" }) }), children: SORT_OPTIONS.map((option) => (_jsxs(Button, { variant: "row", size: "xs", radius: "none", onClick: () => {
                                onSetSortMode(option.value);
                                onSetSortMenuOpen(false);
                            }, className: cn('gap-2', sortMode === option.value && 'text-accent'), children: [_jsx(option.icon, { className: "size-3 shrink-0" }), _jsx("span", { className: "flex-1", children: option.label }), sortMode === option.value ? _jsx(Check, { className: "size-3 shrink-0" }) : null] }, option.value))) })] })] }));
}
export function SidebarSettingsButton({ onOpenSettings }) {
    return (_jsx("div", { className: "no-drag shrink-0", children: _jsxs(Button, { variant: "row", size: "none", radius: "none", "aria-label": "Settings", onClick: onOpenSettings, className: "h-9 gap-2.5 px-4", children: [_jsx(Settings, { className: "size-3.5" }), _jsx("span", { className: "text-[14px] text-text-secondary", children: "Settings" })] }) }));
}

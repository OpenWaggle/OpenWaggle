import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useNavigate } from '@tanstack/react-router';
import { Archive, Cable, GitBranch, Network, PackageOpen, Palette, Settings2, Waypoints, } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
const NAV_ITEMS = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'waggle', label: 'Waggle Mode', icon: Waypoints },
    { id: 'extensions', label: 'Extensions', icon: PackageOpen },
    { id: 'mcp', label: 'MCP', icon: Network },
    { id: 'worktrees', label: 'Worktrees', icon: GitBranch },
    { id: 'archived', label: 'Archived items', icon: Archive },
    { id: 'connections', label: 'Connections', icon: Cable },
];
export function SettingsNav({ activeTab }) {
    const navigate = useNavigate();
    function navigateToTab(tab) {
        if (tab === 'general') {
            void navigate({ to: '/settings' });
            return;
        }
        void navigate({ to: '/settings/$tab', params: { tab } });
    }
    return (_jsx("nav", { className: "flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-border p-2", children: NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (_jsxs(Button, { variant: isActive ? 'accent' : 'row', size: "md", align: "start", fullWidth: true, onClick: () => navigateToTab(item.id), className: cn('gap-2.5', isActive ? 'bg-[#17130a] font-medium' : 'text-text-tertiary'), children: [_jsx(item.icon, { className: "size-4 shrink-0" }), _jsx("span", { children: item.label })] }, item.id));
        }) }));
}

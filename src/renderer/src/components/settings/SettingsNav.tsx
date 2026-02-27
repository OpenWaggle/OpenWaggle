import {
  Archive,
  Blocks,
  Cable,
  Folders,
  GitBranch,
  Palette,
  Settings2,
  Sliders,
  Waypoints,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SettingsTab } from '@/stores/ui-store'
import { useUIStore } from '@/stores/ui-store'

interface NavItem {
  id: SettingsTab
  label: string
  icon: typeof Settings2
  enabled: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: Settings2, enabled: true },
  { id: 'configuration', label: 'Configuration', icon: Sliders, enabled: false },
  { id: 'waggle', label: 'Waggle Mode', icon: Waypoints, enabled: true },
  { id: 'personalization', label: 'Personalization', icon: Palette, enabled: false },
  { id: 'git', label: 'Git', icon: GitBranch, enabled: false },
  { id: 'environments', label: 'Environments', icon: Blocks, enabled: false },
  { id: 'worktrees', label: 'Worktrees', icon: Folders, enabled: false },
  { id: 'archived', label: 'Archived threads', icon: Archive, enabled: false },
  { id: 'connections', label: 'Connections', icon: Cable, enabled: true },
]

export function SettingsNav(): React.JSX.Element {
  const activeTab = useUIStore((s) => s.activeSettingsTab)
  const setActiveSettingsTab = useUIStore((s) => s.setActiveSettingsTab)

  return (
    <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-border py-2 px-2">
      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.id
        return (
          <button
            key={item.id}
            type="button"
            disabled={!item.enabled}
            onClick={() => setActiveSettingsTab(item.id)}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors',
              isActive
                ? 'bg-[#17130a] text-accent font-medium'
                : item.enabled
                  ? 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'
                  : 'text-text-muted/50 cursor-not-allowed',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

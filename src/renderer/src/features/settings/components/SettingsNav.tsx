import { useNavigate } from '@tanstack/react-router'
import {
  Archive,
  Cable,
  GitBranch,
  Globe2,
  Keyboard,
  Network,
  PackageOpen,
  Palette,
  Pickaxe,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import type { SettingsTab } from '@/shell/ui-store'

interface NavItem {
  id: SettingsTab
  label: string
  icon: typeof Settings2
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'browser', label: 'Browser', icon: Globe2 },
  { id: 'actions', label: 'Project actions', icon: Play },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'waggle', label: 'Waggle Mode', icon: Waypoints },
  { id: 'extensions', label: 'Extensions', icon: PackageOpen },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'agents', label: 'Agents', icon: Pickaxe },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'mcp', label: 'MCP', icon: Network },
  { id: 'worktrees', label: 'Worktrees', icon: GitBranch },
  { id: 'archived', label: 'Archived items', icon: Archive },
  { id: 'connections', label: 'Connections', icon: Cable },
]

interface SettingsNavProps {
  readonly activeTab: SettingsTab
}

export function SettingsNav({ activeTab }: SettingsNavProps) {
  const navigate = useNavigate()

  function navigateToTab(tab: SettingsTab) {
    if (tab === 'general') {
      void navigate({ to: '/settings' })
      return
    }

    void navigate({ to: '/settings/$tab', params: { tab } })
  }

  return (
    <>
      <div className="border-b border-border px-4 py-2 @min-[640px]/settings:hidden">
        <Select
          aria-label="Settings section"
          value={activeTab}
          className="w-full"
          onChange={(event) => {
            const tab = NAV_ITEMS.find((item) => item.id === event.target.value)
            if (tab) navigateToTab(tab.id)
          }}
        >
          {NAV_ITEMS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </div>
      <nav className="hidden w-50 @min-[640px]/settings:flex shrink-0 flex-col gap-0.5 border-r border-border p-2">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id
          return (
            <Button
              variant={isActive ? 'accent' : 'row'}
              size="md"
              align="start"
              fullWidth
              key={item.id}
              onClick={() => navigateToTab(item.id)}
              className={cn(
                'gap-2.5',
                isActive ? 'bg-accent/10 font-medium' : 'text-text-tertiary',
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Button>
          )
        })}
      </nav>
    </>
  )
}

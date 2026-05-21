import { useNavigate } from '@tanstack/react-router'
import { Archive, Cable, Network, Settings2, Waypoints } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { SettingsTab } from '@/shell/ui-store'

interface NavItem {
  id: SettingsTab
  label: string
  icon: typeof Settings2
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'waggle', label: 'Waggle Mode', icon: Waypoints },
  { id: 'mcp', label: 'MCP', icon: Network },
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
    <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-border p-2">
      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.id
        return (
          <Button
            variant={isActive ? 'accent' : 'row'}
            size="md"
            key={item.id}
            onClick={() => navigateToTab(item.id)}
            className={cn('gap-2.5', isActive ? 'bg-[#17130a] font-medium' : 'text-text-tertiary')}
          >
            <item.icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Button>
        )
      })}
    </nav>
  )
}

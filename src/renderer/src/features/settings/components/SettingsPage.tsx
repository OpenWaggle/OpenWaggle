import { match } from '@diegogbrisa/ts-match'
import { ArrowLeft } from 'lucide-react'
import { useNavigateBackToApp } from '@/features/chat/hooks'
import { ProjectActionsSettings } from '@/features/project-actions/components'
import { useFullProviderCatalog } from '@/features/providers/hooks'
import { ScheduledTasksSettings } from '@/features/scheduled-tasks/components'
import { SkillsPanel } from '@/features/skills/components'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { SettingsTab } from '@/shell/ui-store'
import { useFullscreen } from '@/shell/useFullscreen'
import { SettingsNav } from './SettingsNav'
import { AgentsSettingsSection } from './sections/AgentsSettingsSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { ArchivedSection } from './sections/ArchivedSection'
import { BrowserProfilesSection } from './sections/BrowserProfilesSection'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { ExtensionsSection } from './sections/ExtensionsSection'
import { GeneralSection } from './sections/GeneralSection'
import { McpSection } from './sections/McpSection'
import { PermissionsSection } from './sections/PermissionsSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { WaggleSection } from './sections/WaggleSection'
import { WorktreesSection } from './sections/WorktreesSection'

interface SettingsPageProps {
  readonly activeTab: SettingsTab
}

export function SettingsPage({ activeTab }: SettingsPageProps) {
  const navigateBackToApp = useNavigateBackToApp()
  const isFullscreen = useFullscreen()
  useFullProviderCatalog()

  return (
    <div className="@container/settings flex size-full flex-col bg-bg">
      {/* Header */}
      <div
        className={cn(
          'drag-region flex shrink-0 items-center gap-3 border-b border-border px-4 h-12',
          !isFullscreen && 'pl-20',
        )}
      >
        <Button
          variant="unstyled"
          type="button"
          onClick={navigateBackToApp}
          className="no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="size-4" />
          <span className="text-xs">Back to app</span>
        </Button>
        <span className="no-drag text-base font-medium text-text-primary">Settings</span>
      </div>

      {/* Body: Nav + Content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden @min-[640px]/settings:flex-row">
        <SettingsNav activeTab={activeTab} />

        {/* Content area — fills available width */}
        <div
          className={cn(
            'min-w-0 flex-1',
            activeTab === 'skills' || activeTab === 'agents' || activeTab === 'scheduled'
              ? 'overflow-hidden'
              : 'overflow-y-auto px-4 py-5 @min-[640px]/settings:px-10 @min-[640px]/settings:py-8',
          )}
        >
          <SettingsTabContent tab={activeTab} />
        </div>
      </div>
    </div>
  )
}

function SettingsTabContent({ tab }: { readonly tab: SettingsTab }) {
  return match(tab)
    .with('general', () => <GeneralSection />)
    .with('browser', () => <BrowserProfilesSection />)
    .with('actions', () => <ProjectActionsSettings />)
    .with('shortcuts', () => <ShortcutsSection />)
    .with('appearance', () => <AppearanceSection />)
    .with('waggle', () => <WaggleSection />)
    .with('extensions', () => <ExtensionsSection />)
    .with('skills', () => <SkillsPanel />)
    .with('agents', () => <AgentsSettingsSection />)
    .with('scheduled', () => <ScheduledTasksSettings />)
    .with('permissions', () => <PermissionsSection />)
    .with('mcp', () => <McpSection />)
    .with('worktrees', () => <WorktreesSection />)
    .with('connections', () => <ConnectionsSection />)
    .with('archived', () => <ArchivedSection />)
    .otherwise(() => <GeneralSection />)
}

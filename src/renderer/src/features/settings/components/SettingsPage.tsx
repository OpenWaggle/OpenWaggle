import { match } from '@diegogbrisa/ts-match'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useChat } from '@/features/chat/hooks'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { SettingsTab } from '@/shell/ui-store'
import { useFullscreen } from '@/shell/useFullscreen'
import { SettingsNav } from './SettingsNav'
import { ArchivedSection } from './sections/ArchivedSection'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { GeneralSection } from './sections/GeneralSection'
import { McpSection } from './sections/McpSection'
import { WaggleSection } from './sections/WaggleSection'

interface SettingsPageProps {
  readonly activeTab: SettingsTab
}

export function SettingsPage({ activeTab }: SettingsPageProps) {
  const navigate = useNavigate()
  const { activeSessionId } = useChat()
  const isFullscreen = useFullscreen()

  function navigateBackToApp() {
    if (activeSessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: String(activeSessionId) },
      })
      return
    }

    void navigate({ to: '/' })
  }

  return (
    <div className="flex size-full flex-col bg-bg">
      {/* Header */}
      <div
        className={cn(
          'drag-region flex shrink-0 items-center gap-3 border-b border-border px-4 h-12',
          !isFullscreen && 'pl-[80px]',
        )}
      >
        <Button
          variant="unstyled"
          type="button"
          onClick={navigateBackToApp}
          className="no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="size-4" />
          <span className="text-[13px]">Back to app</span>
        </Button>
        <span className="no-drag text-[15px] font-medium text-text-primary">Settings</span>
      </div>

      {/* Body: Nav + Content */}
      <div className="flex flex-1 overflow-hidden">
        <SettingsNav activeTab={activeTab} />

        {/* Content area — fills available width */}
        <div className="flex-1 overflow-y-auto px-10 py-8">
          <SettingsTabContent tab={activeTab} />
        </div>
      </div>
    </div>
  )
}

function SettingsTabContent({ tab }: { tab: SettingsTab }) {
  return match(tab)
    .with('general', () => <GeneralSection />)
    .with('waggle', () => <WaggleSection />)
    .with('mcp', () => <McpSection />)
    .with('connections', () => <ConnectionsSection />)
    .with('archived', () => <ArchivedSection />)
    .otherwise(() => <GeneralSection />)
}

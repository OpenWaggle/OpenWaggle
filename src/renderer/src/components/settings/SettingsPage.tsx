import { choose } from '@shared/utils/decision'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useChat } from '@/hooks/useChat'
import { useFullscreen } from '@/hooks/useFullscreen'
import { cn } from '@/lib/cn'
import type { SettingsTab } from '@/stores/ui-store'
import { SettingsNav } from './SettingsNav'
import { ArchivedSection } from './sections/ArchivedSection'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { GeneralSection } from './sections/GeneralSection'
import { WaggleSection } from './sections/WaggleSection'

interface SettingsPageProps {
  readonly activeTab: SettingsTab
}

export function SettingsPage({ activeTab }: SettingsPageProps) {
  const navigate = useNavigate()
  const { activeConversationId } = useChat()
  const isFullscreen = useFullscreen()

  function navigateBackToApp(): void {
    if (activeConversationId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: String(activeConversationId) },
      })
      return
    }

    void navigate({ to: '/' })
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      {/* Header */}
      <div
        className={cn(
          'drag-region flex shrink-0 items-center gap-3 border-b border-border px-4 h-12',
          !isFullscreen && 'pl-[80px]',
        )}
      >
        <button
          type="button"
          onClick={navigateBackToApp}
          className="no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-[13px]">Back to app</span>
        </button>
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
  return choose(tab)
    .case('general', () => <GeneralSection />)
    .case('waggle', () => <WaggleSection />)
    .case('connections', () => <ConnectionsSection />)
    .case('archived', () => <ArchivedSection />)
    .catchAll(() => <GeneralSection />)
}

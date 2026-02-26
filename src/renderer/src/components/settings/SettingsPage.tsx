import { ArrowLeft } from 'lucide-react'
import { useFullscreen } from '@/hooks/useFullscreen'
import { cn } from '@/lib/cn'
import type { SettingsTab } from '@/stores/ui-store'
import { useUIStore } from '@/stores/ui-store'
import { SettingsNav } from './SettingsNav'
import { ConnectionsSection } from './sections/ConnectionsSection'
import { CoworkSection } from './sections/CoworkSection'
import { GeneralSection } from './sections/GeneralSection'

export function SettingsPage(): React.JSX.Element {
  const activeTab = useUIStore((s) => s.activeSettingsTab)
  const setActiveSettingsTab = useUIStore((s) => s.setActiveSettingsTab)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const isFullscreen = useFullscreen()

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
          onClick={closeSettings}
          className="no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="text-[13px]">Back to app</span>
        </button>
        <span className="no-drag text-[15px] font-medium text-text-primary">Settings</span>
      </div>

      {/* Body: Nav + Content */}
      <div className="flex flex-1 overflow-hidden">
        <SettingsNav activeTab={activeTab} onTabChange={setActiveSettingsTab} />

        {/* Content area — fills available width */}
        <div className="flex-1 overflow-y-auto px-10 py-8">
          <SettingsTabContent tab={activeTab} />
        </div>
      </div>
    </div>
  )
}

function SettingsTabContent({ tab }: { tab: SettingsTab }): React.JSX.Element {
  switch (tab) {
    case 'general':
      return <GeneralSection />
    case 'cowork':
      return <CoworkSection />
    case 'connections':
      return <ConnectionsSection />
    default:
      return <GeneralSection />
  }
}

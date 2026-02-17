import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Settings as SettingsType } from '@shared/types/settings'
import { FolderOpen, Plus, Settings } from 'lucide-react'
import { ModelSelector } from '@/components/shared/ModelSelector'
import { cn } from '@/lib/cn'
import { projectName } from '@/lib/format'

interface HeaderProps {
  model: SupportedModelId
  onModelChange: (model: SupportedModelId) => void
  settings: SettingsType
  providerModels: ProviderInfo[]
  projectPath: string | null
  conversationTitle: string | null
  onSelectProject: () => void
  onOpenSettings: () => void
  onNewConversation: () => void
}

export function Header({
  model,
  onModelChange,
  settings,
  providerModels,
  projectPath,
  conversationTitle,
  onSelectProject,
  onOpenSettings,
  onNewConversation,
}: HeaderProps): React.JSX.Element {
  return (
    <header className="drag-region flex h-12 items-center justify-between border-b border-border bg-bg-secondary px-4 pl-20">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="New conversation"
        >
          <Plus className="h-4 w-4" />
        </button>

        {conversationTitle && (
          <span className="text-sm text-text-secondary truncate max-w-[300px]">
            {conversationTitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <ModelSelector
          value={model}
          onChange={onModelChange}
          settings={settings}
          providerModels={providerModels}
        />

        <button
          type="button"
          onClick={onSelectProject}
          className={cn(
            'no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
            projectPath
              ? 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              : 'text-accent hover:bg-accent/10',
          )}
          title={projectPath ?? 'Select project folder'}
        >
          <FolderOpen className="h-4 w-4" />
          <span className="truncate max-w-[120px]">{projectName(projectPath)}</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="no-drag flex items-center rounded-md p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { MainPanel } from '@/components/layout/MainPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useChat } from '@/hooks/useChat'
import { useProject } from '@/hooks/useProject'
import { useSettings, useSettingsSetup } from '@/hooks/useSettings'

export function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Initialize subscriptions
  useSettingsSetup()

  const { settings, isLoaded, providerModels, setDefaultModel } = useSettings()
  const { projectPath, selectFolder } = useProject()
  const { activeConversation, createConversation, loadConversations } = useChat()

  // Load conversations on mount
  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Always use the user's selected default — individual messages record their own model
  const currentModel = settings.defaultModel

  const handleNewConversation = useCallback(async () => {
    await createConversation(currentModel, projectPath)
  }, [createConversation, currentModel, projectPath])

  const handleModelChange = useCallback(
    (model: typeof currentModel) => {
      setDefaultModel(model)
    },
    [setDefaultModel],
  )

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div className="text-text-muted text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <Header
        model={currentModel}
        onModelChange={handleModelChange}
        settings={settings}
        providerModels={providerModels}
        projectPath={projectPath}
        conversationTitle={activeConversation?.title ?? null}
        onSelectProject={selectFolder}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewConversation={handleNewConversation}
      />

      <MainPanel model={currentModel} projectPath={projectPath} hasProject={!!projectPath} />

      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

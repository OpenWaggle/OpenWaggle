import { useCallback, useEffect, useState } from 'react'
import { Header } from '@/components/layout/Header'
import { MainPanel } from '@/components/layout/MainPanel'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { useChat, useChatSetup } from '@/hooks/useChat'
import { useProject } from '@/hooks/useProject'
import { useSettings, useSettingsSetup } from '@/hooks/useSettings'

export function App(): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Initialize subscriptions
  useChatSetup()
  useSettingsSetup()

  const { settings, isLoaded, setDefaultModel } = useSettings()
  const { projectPath, selectFolder } = useProject()
  const {
    activeConversation,
    activeConversationId,
    status,
    streamingText,
    streamingParts,
    sendMessage,
    cancelAgent,
    createConversation,
    loadConversations,
  } = useChat()

  // Load conversations on mount
  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Always use the user's selected default — individual messages record their own model
  const currentModel = settings.defaultModel

  const handleNewConversation = useCallback(async () => {
    await createConversation(currentModel, projectPath)
  }, [createConversation, currentModel, projectPath])

  const handleSend = useCallback(
    async (content: string) => {
      let convId = activeConversationId
      if (!convId) {
        convId = await createConversation(currentModel, projectPath)
      }
      await sendMessage(content, currentModel)
    },
    [activeConversationId, createConversation, currentModel, projectPath, sendMessage],
  )

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
        projectPath={projectPath}
        conversationTitle={activeConversation?.title ?? null}
        onSelectProject={selectFolder}
        onOpenSettings={() => setSettingsOpen(true)}
        onNewConversation={handleNewConversation}
      />

      <MainPanel
        messages={activeConversation?.messages ?? []}
        status={status}
        streamingText={streamingText}
        streamingParts={streamingParts}
        onSend={handleSend}
        onCancel={cancelAgent}
        hasProject={!!projectPath}
      />

      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

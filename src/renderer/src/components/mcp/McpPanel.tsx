import { useMcp } from '@/hooks/useMcp'
import { McpAddForm } from './McpAddForm'
import { McpListView } from './McpListView'

export function McpPanel() {
  const mcp = useMcp()

  if (mcp.isAddFormOpen) {
    return <McpAddForm onBack={() => mcp.setAddFormOpen(false)} onSubmit={mcp.addServer} />
  }

  return (
    <McpListView
      servers={mcp.servers}
      isLoading={mcp.isLoading}
      loadError={mcp.loadError}
      actionError={mcp.actionError}
      onAddClick={() => mcp.setAddFormOpen(true)}
      onInstall={mcp.addServer}
      onToggle={mcp.toggleServer}
      onRemove={mcp.removeServer}
    />
  )
}

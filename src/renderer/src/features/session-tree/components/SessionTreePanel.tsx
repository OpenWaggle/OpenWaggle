import { useSessionTreePanelController } from '../hooks/useSessionTreePanelController'
import type { SessionTreePanelProps } from '../model'
import { SessionTreePanelContent } from './SessionTreePanelContent'
import { SessionTreePanelFilters } from './SessionTreePanelFilters'
import { SessionTreePanelHeader } from './SessionTreePanelHeader'

export function SessionTreePanel({ onClose }: SessionTreePanelProps) {
  const panel = useSessionTreePanelController(onClose)

  return (
    <section className="flex h-full min-w-0 flex-col bg-diff-bg" aria-label="Session Tree">
      <SessionTreePanelHeader onClose={panel.header.onClose} />
      <SessionTreePanelFilters filters={panel.filters} />
      <SessionTreePanelContent content={panel.content} />
    </section>
  )
}

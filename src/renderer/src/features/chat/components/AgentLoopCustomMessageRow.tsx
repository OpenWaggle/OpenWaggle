import { ExtensionAgentLoopSurface } from '@/features/extensions'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatRowRenderContext } from './ChatRowRenderContext'

export function CustomMessageRow({
  row,
  extensions,
}: {
  readonly row: Extract<ChatRow, { readonly type: 'agent-loop-custom-message' }>
  readonly extensions: ChatRowRenderContext['extensions']
}) {
  return (
    <ExtensionAgentLoopSurface
      input={{
        surface: 'custom-message',
        message: { name: row.event.name, value: row.event.value ?? null },
      }}
      projectPaths={extensions.projectPaths}
      registry={extensions.registry}
    />
  )
}

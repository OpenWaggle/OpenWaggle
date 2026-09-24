import { SessionSummaryExpandedPanel } from './SessionSummaryExpandedPanel'
import { SessionSummaryHubDialogs } from './SessionSummaryHubDialogs'
import { createSessionSummaryPanelSections } from './SessionSummaryPanelSections'
import { hasSummaryContent, type SessionSummaryHubInput } from './session-summary-hub-types'
import { useSessionSummaryHubController } from './use-session-summary-hub-controller'

export type { SessionSummaryHubInput } from './session-summary-hub-types'

export function SessionSummaryHub({ input }: { readonly input: SessionSummaryHubInput }) {
  const { session } = input
  const workspaceActivityAvailable = useWorkspaceActivityAvailable(
    session?.projectPath ? { projectPath: session.projectPath, sessionId: session.id } : null,
  )
  const availableInput = { ...input, workspaceActivityAvailable }
  if (!session || !hasSummaryContent(availableInput)) return null
  return <AvailableSessionSummaryHub input={availableInput} />
}

function AvailableSessionSummaryHub({ input }: { readonly input: SessionSummaryHubInput }) {
  const controller = useSessionSummaryHubController(input)
  const session = input.session
  if (!session) return null

  const sections = createSessionSummaryPanelSections({ input, session, controller })
  return (
    <>
      {controller.panel.visible ? (
        <SessionSummaryExpandedPanel
          input={{
            panelId: controller.panel.id,
            sessionId: String(session.id),
            sections,
            transient: controller.panel.transient,
          }}
        />
      ) : null}
      <SessionSummaryHubDialogs session={session} controller={controller} />
    </>
  )
}

import { useWorkspaceActivityAvailable } from '@/features/project-actions'

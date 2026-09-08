import { SessionSummaryExpandedPanel } from './SessionSummaryExpandedPanel'
import { SessionSummaryHubDialogs } from './SessionSummaryHubDialogs'
import { createSessionSummaryPanelSections } from './SessionSummaryPanelSections'
import type { SessionSummaryHubInput } from './session-summary-hub-types'
import { useSessionSummaryHubController } from './use-session-summary-hub-controller'

export type { SessionSummaryHubInput } from './session-summary-hub-types'

export function SessionSummaryHub({ input }: { readonly input: SessionSummaryHubInput }) {
  const { session, messageCount } = input
  if (!session || messageCount === 0) return null
  return <AvailableSessionSummaryHub input={input} />
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
            sections,
            transient: controller.panel.transient,
          }}
        />
      ) : null}
      <SessionSummaryHubDialogs session={session} controller={controller} />
    </>
  )
}

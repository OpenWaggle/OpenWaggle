import type { SessionDetail } from '@shared/types/session'
import type { ReactNode } from 'react'
import { ExtensionSessionSummarySections } from './ExtensionSessionSummarySections'
import { HiveSummarySection } from './HiveSummarySection'
import { SessionResourcesCatalogFailure } from './SessionResourcesCatalogFailure'
import type { SessionSummaryPanelSection } from './SessionSummaryExpandedPanel'
import {
  EnvironmentSummarySection,
  ResourceSummarySection,
  SessionChangeRequestsSection,
} from './SessionSummarySections'
import { SessionSummarySubscriptions } from './SessionSummarySubscriptions'
import type { SessionSummaryHubInput } from './session-summary-hub-types'
import type { SessionSummaryHubController } from './use-session-summary-hub-controller'

const SESSION_SUMMARY_SECTION_IDENTITIES = [
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'environment', label: 'Environment' },
  { id: 'change-requests', label: 'Change requests' },
  { id: 'extensions-context', label: 'Extension context' },
  { id: 'hive', label: 'Hive' },
  { id: 'extensions-coordination', label: 'Extension coordination' },
  { id: 'resource-catalog', label: 'Resource catalog' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'sources', label: 'Sources' },
  { id: 'extensions-details', label: 'Extension details' },
] as const satisfies readonly Omit<SessionSummaryPanelSection, 'content'>[]

export const SESSION_SUMMARY_SECTION_ORDER = Object.freeze(
  SESSION_SUMMARY_SECTION_IDENTITIES.map((section) => section.id),
)

type SessionSummarySectionId = (typeof SESSION_SUMMARY_SECTION_IDENTITIES)[number]['id']
type SessionSummarySectionContent = Readonly<Record<SessionSummarySectionId, ReactNode>>

interface SessionSummarySectionContext {
  readonly input: SessionSummaryHubInput
  readonly session: SessionDetail
  readonly controller: SessionSummaryHubController
}

function extensionSection(
  context: SessionSummarySectionContext,
  placement: 'context' | 'coordination' | 'details',
) {
  const { input, controller } = context
  return (
    <ExtensionSessionSummarySections
      registry={input.extensionRegistry}
      projectPaths={input.extensionProjectPaths}
      sessionId={controller.sessionId}
      messageCount={input.messageCount}
      placement={placement}
      resources={controller.resources.all}
      onOpenResources={input.onOpenResources}
      onOpenSidePanel={input.onOpenExtensionSidePanel}
    />
  )
}

function composeSections(content: SessionSummarySectionContent) {
  return SESSION_SUMMARY_SECTION_IDENTITIES.map((section) => ({
    ...section,
    content: content[section.id],
  })) satisfies readonly SessionSummaryPanelSection[]
}

export function createSessionSummaryPanelSections(context: SessionSummarySectionContext) {
  const { input, session, controller } = context
  const { disclosures, git, resources } = controller

  return composeSections({
    subscriptions: (
      <SessionSummarySubscriptions
        sessionId={session.id}
        projectPath={session.projectPath}
        visible={controller.panel.visible}
        expanded={disclosures.subscriptions.expanded}
        onExpandedChange={disclosures.subscriptions.setExpanded}
      />
    ),
    environment: (
      <EnvironmentSummarySection
        input={{
          ...git.environment,
          expanded: disclosures.environment.expanded,
          onExpandedChange: disclosures.environment.setExpanded,
        }}
      />
    ),
    'change-requests': (
      <SessionChangeRequestsSection
        resources={resources.changeRequests}
        currentUrl={git.environment.vcsStatus?.changeRequest?.url ?? null}
        provider={git.environment.vcsStatus?.sourceControlProvider?.id ?? null}
        expanded={disclosures.changeRequests.expanded}
        onExpandedChange={disclosures.changeRequests.setExpanded}
        onOpen={input.onOpenChangeRequest ?? (() => {})}
      />
    ),
    'extensions-context': extensionSection(context, 'context'),
    hive: (
      <HiveSummarySection
        key={controller.sessionId}
        sessionId={controller.sessionId}
        onNavigateSession={input.onNavigateSession}
      />
    ),
    'extensions-coordination': extensionSection(context, 'coordination'),
    'resource-catalog': resources.failed ? (
      <section className="border-t border-border p-2">
        <SessionResourcesCatalogFailure onRetry={resources.retry} />
      </section>
    ) : null,
    outputs: (
      <ResourceSummarySection
        input={{
          title: 'Outputs',
          resources: resources.outputs,
          count: resources.outputCount,
          expanded: disclosures.outputs.expanded,
          onExpandedChange: disclosures.outputs.setExpanded,
          onOpenResources: input.onOpenResources,
          onOpenImage: resources.openImage,
        }}
      />
    ),
    sources: (
      <ResourceSummarySection
        input={{
          title: 'Sources',
          resources: resources.sources,
          count: resources.sourceCount,
          expanded: disclosures.sources.expanded,
          onExpandedChange: disclosures.sources.setExpanded,
          onOpenResources: input.onOpenResources,
          onOpenImage: resources.openImage,
          onAttachSource: resources.attachSource,
          onReferenceSource: resources.referenceSource,
        }}
      />
    ),
    'extensions-details': extensionSection(context, 'details'),
  })
}

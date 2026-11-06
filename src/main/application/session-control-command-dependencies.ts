import type { ActionRunService } from '../ports/action-run-service'
import type { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import type { AgentSteeringService } from '../ports/agent-steering-service'
import type { DesktopServiceBroker } from '../ports/desktop-service-broker'
import type { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import type { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import type { SessionControlIdentityService } from '../ports/session-control-identity-service'
import type { SessionControlOperationJournal } from '../ports/session-control-operation-journal'
import type { SessionControlRepository } from '../ports/session-control-repository'
import type { SessionDelegationRepository } from '../ports/session-delegation-repository'
import type { SessionDescendantRunRepository } from '../ports/session-descendant-run-repository'
import type { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import type { SessionExportLiveAuthority } from '../ports/session-export-live-authority'
import type { SessionExportOperationRepository } from '../ports/session-export-operation-repository'
import type { SessionExportResourceResolver } from '../ports/session-export-resource-resolver'
import type { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import type { SessionOrganizationRepository } from '../ports/session-organization-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionQueryRepository } from '../ports/session-query-repository'
import type { SessionReportDeliveryService } from '../ports/session-report-delivery-service'
import type { SessionReportRepository } from '../ports/session-report-repository'
import type { SessionWorkspaceHandoffService } from '../ports/session-workspace-handoff-service'
import type { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import type { TerminalService } from '../ports/terminal-service'

/** What Session Control commands need from the Session Host to run. */
export type SessionControlCommandDependencies =
  | AgentRunInterruptionService
  | AgentSteeringService
  | SessionAuthorizationTargetRepository
  | SessionControlAttachmentService
  | SessionControlIdentityService
  | SessionControlOperationJournal
  | SessionControlRepository
  | SessionDescendantRunRepository
  | SessionExportArtifactWriter
  | SessionExportLiveAuthority
  | SessionExportOperationRepository
  | SessionExportResourceResolver
  | SessionQueryRepository
  | SessionReportRepository
  | SessionReportDeliveryService
  | SessionProjectionRepository
  | SessionDelegationRepository
  | SessionOrchestrationUpdateDeliveryService
  | SessionOrganizationRepository
  | SessionWorkspaceHandoffService
  | TerminalService
  | ActionRunService
  | SessionWorkspaceResourceRepository
  | DesktopServiceBroker

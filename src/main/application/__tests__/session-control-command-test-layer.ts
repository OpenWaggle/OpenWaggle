import { fromPartial } from '@total-typescript/shoehorn'
import * as Layer from 'effect/Layer'
import { AgentRunInterruptionService } from '../../ports/agent-run-interruption-service'
import { AgentSteeringService } from '../../ports/agent-steering-service'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionDescendantRunRepository } from '../../ports/session-descendant-run-repository'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import { SessionExportLiveAuthority } from '../../ports/session-export-live-authority'
import { SessionExportOperationRepository } from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionOrganizationRepository } from '../../ports/session-organization-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionReportDeliveryService } from '../../ports/session-report-delivery-service'
import { SessionReportRepository } from '../../ports/session-report-repository'
import { SessionWorkspaceHandoffService } from '../../ports/session-workspace-handoff-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { NoopActionRunServiceLayer } from './action-run-service-test-layer'
import { noUndeliveredSteers } from './agent-steering-test-layer'
import { NoopSessionDesktopLayer } from './desktop-service-test-layer'

/** Services a Session Control command needs that these tests never reach. */
export function unusedCommandDependencies() {
  return Layer.mergeAll(
    NoopSessionDesktopLayer,
    NoopActionRunServiceLayer,
    Layer.succeed(SessionWorkspaceResourceRepository, fromPartial({})),
    Layer.succeed(AgentRunInterruptionService, fromPartial({})),
    Layer.succeed(AgentSteeringService, fromPartial(noUndeliveredSteers)),
    Layer.succeed(SessionAuthorizationTargetRepository, fromPartial({})),
    Layer.succeed(SessionControlAttachmentService, fromPartial({})),
    Layer.succeed(SessionControlOperationJournal, fromPartial({})),
    Layer.succeed(SessionDelegationRepository, fromPartial({})),
    Layer.succeed(SessionDescendantRunRepository, fromPartial({})),
    Layer.succeed(SessionExportArtifactWriter, fromPartial({})),
    Layer.succeed(SessionExportLiveAuthority, fromPartial({})),
    Layer.succeed(SessionExportOperationRepository, fromPartial({})),
    Layer.succeed(SessionExportResourceResolver, fromPartial({})),
    Layer.succeed(SessionOrganizationRepository, fromPartial({})),
    Layer.succeed(SessionProjectionRepository, fromPartial({})),
    Layer.succeed(SessionQueryRepository, fromPartial({})),
    Layer.succeed(SessionReportDeliveryService, fromPartial({})),
    Layer.succeed(SessionReportRepository, fromPartial({})),
    Layer.succeed(SessionWorkspaceHandoffService, fromPartial({})),
  )
}

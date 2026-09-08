import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { SessionControlRunExecutor } from '../../ports/session-control-run-executor'
import { SessionControlRunLifecycleRepository } from '../../ports/session-control-run-lifecycle-repository'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionDescendantRunRepository } from '../../ports/session-descendant-run-repository'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import { SessionExportLiveAuthority } from '../../ports/session-export-live-authority'
import { SessionExportOperationRepository } from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { SessionOrganizationRepository } from '../../ports/session-organization-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { SessionReportDeliveryService } from '../../ports/session-report-delivery-service'
import { SessionReportRepository } from '../../ports/session-report-repository'
import { SessionWorkspaceHandoffService } from '../../ports/session-workspace-handoff-service'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import {
  controlPayload,
  localUser,
  settingsLayer,
} from './local-session-command-dispatcher.test-support'
import { makePromotionReplacementLayer } from './session-control-promotion-replacement.test-support'

function unusedDispatcherCommandDependencies() {
  return Layer.mergeAll(
    Layer.succeed(SessionAuthorizationTargetRepository, fromPartial({})),
    Layer.succeed(SessionControlRepository, fromPartial({})),
    Layer.succeed(SessionControlRunExecutor, fromPartial({})),
    Layer.succeed(SessionControlRunLifecycleRepository, fromPartial({})),
    Layer.succeed(SessionDelegationRepository, fromPartial({})),
    Layer.succeed(SessionDescendantRunRepository, fromPartial({})),
    Layer.succeed(SessionExportArtifactWriter, fromPartial({})),
    Layer.succeed(SessionExportLiveAuthority, fromPartial({})),
    Layer.succeed(SessionExportOperationRepository, fromPartial({})),
    Layer.succeed(SessionExportResourceResolver, fromPartial({})),
    Layer.succeed(SessionOrchestrationUpdateDeliveryService, fromPartial({})),
    Layer.succeed(SessionOrganizationRepository, fromPartial({})),
    Layer.succeed(SessionProjectionRepository, fromPartial({})),
    Layer.succeed(SessionQueryRepository, fromPartial({})),
    Layer.succeed(SessionReportDeliveryService, fromPartial({})),
    Layer.succeed(SessionReportRepository, fromPartial({})),
    Layer.succeed(SessionWorkspaceHandoffService, fromPartial({})),
  )
}

function testLayer(state: Parameters<typeof makePromotionReplacementLayer>[0]) {
  const setup = makePromotionReplacementLayer(state)
  return {
    setup,
    layer: Layer.mergeAll(settingsLayer, unusedDispatcherCommandDependencies(), setup.layer),
  }
}

describe('Local Session attachment transition dispatch', () => {
  it('completes an accepted steer whose attachment release nests inside the dispatcher transition', async () => {
    const { layer, setup } = testLayer({
      sessionId: SessionId('session-worker'),
      revision: 7,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: { state: 'running', revision: 0, items: [] },
    })

    const result = await Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload({
          operation: 'steer',
          sessionId: 'session-worker',
          expectedRunId: 'run-active',
          input: { text: 'Use the corrected order.', attachmentIds: ['attachment-steer'] },
        }),
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      contract: 'session-control-v2',
      response: { outcome: { effect: 'steered-run' } },
    })
    expect(setup.release).toHaveBeenCalledOnce()
  })

  it('completes an accepted promotion whose attachment release nests inside the dispatcher transition', async () => {
    const { layer, setup } = testLayer({
      sessionId: SessionId('session-worker'),
      revision: 5,
      run: { state: 'active', runId: RunId('run-active') },
      followUpQueue: {
        state: 'running',
        revision: 2,
        items: [
          {
            id: FollowUpId('follow-up-next'),
            deliveryState: 'pending',
            intent: {
              text: 'Promote this now.',
              attachmentIds: ['attachment-promote'],
              callerId: localUser.callerId,
              acceptedAt: 1_000,
              idempotencyKey: 'follow-up',
            },
          },
        ],
      },
    })

    const result = await Effect.runPromise(
      dispatchAdmittedSessionControlCommand({
        caller: localUser,
        payload: controlPayload({
          operation: 'promote',
          sessionId: 'session-worker',
          expectedRunId: 'run-active',
          followUpId: 'follow-up-next',
        }),
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toMatchObject({
      contract: 'session-control-v2',
      response: { outcome: { effect: 'promoted-follow-up' } },
    })
    expect(setup.release).toHaveBeenCalledOnce()
  })
})

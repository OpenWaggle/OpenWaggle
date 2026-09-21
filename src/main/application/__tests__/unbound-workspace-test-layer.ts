import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'

/** These desktop-resource fixtures have no Workspace binding or action executions. */
export const UnboundWorkspaceTestLayer = Layer.succeed(
  SessionWorkspaceResourceRepository,
  fromPartial({ getBound: () => Effect.succeed(null) }),
)

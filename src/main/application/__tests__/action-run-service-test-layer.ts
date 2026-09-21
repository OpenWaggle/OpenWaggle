import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ActionRunService } from '../../ports/action-run-service'

const unsupported = () => Effect.fail(new Error('This fixture has no action executions.'))
export const NoopActionRunServiceLayer = Layer.succeed(ActionRunService, {
  start: unsupported,
  list: () => Effect.succeed([]),
  output: unsupported,
  stop: unsupported,
  stopWorkspaceRuns: () => Effect.void,
  stopWorkspaceServices: () => Effect.void,
  withWorkspaceMutation: (_workspaceId, operation) => operation,
  recoverAfterHostLoss: Effect.void,
})

import { Context, type Effect } from 'effect'
import type { ActionRunWorkspace } from './action-run-service'

export interface WorkspaceExecutionAdmissionShape {
  readonly withWorkspaceMutation: <A, E, R>(
    workspaceId: string,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly requireActive: (workspace: ActionRunWorkspace) => Effect.Effect<void, Error>
}
export class WorkspaceExecutionAdmission extends Context.Tag(
  '@openwaggle/WorkspaceExecutionAdmission',
)<WorkspaceExecutionAdmission, WorkspaceExecutionAdmissionShape>() {}

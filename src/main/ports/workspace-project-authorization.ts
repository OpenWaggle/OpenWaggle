import { Context, type Effect } from 'effect'

export interface WorkspaceProjectAuthorizationShape {
  readonly authorize: (projectPath: string) => Effect.Effect<string, Error>
}

export class WorkspaceProjectAuthorization extends Context.Tag(
  '@openwaggle/WorkspaceProjectAuthorization',
)<WorkspaceProjectAuthorization, WorkspaceProjectAuthorizationShape>() {}

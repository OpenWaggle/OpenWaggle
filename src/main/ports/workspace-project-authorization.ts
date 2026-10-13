import { Context, type Effect } from 'effect'

export interface WorkspaceProjectAuthorizationShape {
  readonly authorize: (projectPath: string) => Effect.Effect<string, Error>
  /**
   * The project an authorized path belongs to: for a Session's managed worktree, the Session's
   * durable project, whose files a Run reads; otherwise the path itself.
   */
  readonly projectOfWorkspace?: (authorizedPath: string) => Effect.Effect<string, Error>
}

export class WorkspaceProjectAuthorization extends Context.Tag(
  '@openwaggle/WorkspaceProjectAuthorization',
)<WorkspaceProjectAuthorization, WorkspaceProjectAuthorizationShape>() {}

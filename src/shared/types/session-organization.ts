export type SessionHandoffWorkspaceSelection =
  | { readonly mode: 'local' }
  | { readonly mode: 'existing'; readonly workspaceId: string }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string | undefined
      readonly startFromOrigin?: boolean | undefined
    }

export type SessionOrganizationCommand =
  | { readonly operation: 'rename'; readonly sessionId: string; readonly title: string }
  | { readonly operation: 'archive'; readonly sessionId: string }
  | { readonly operation: 'unarchive'; readonly sessionId: string }
  | {
      readonly operation: 'handoff'
      readonly sessionId: string
      readonly workspace: SessionHandoffWorkspaceSelection
    }

export type SessionOrganizationOutcome =
  | {
      readonly operation: 'rename'
      readonly effect: 'session-renamed'
      readonly sessionId: string
      readonly title: string
    }
  | {
      readonly operation: 'archive'
      readonly effect: 'session-archived'
      readonly sessionId: string
    }
  | {
      /**
       * A Session agent asked, from Run `runId`, to archive its own Session. Archiving stops the
       * Session's Runs, so the Host archives it after that Run completes instead, unless the
       * Session changed since.
       */
      readonly operation: 'archive'
      readonly effect: 'session-archive-deferred'
      readonly sessionId: string
      readonly runId: string
    }
  | {
      readonly operation: 'unarchive'
      readonly effect: 'session-unarchived'
      readonly sessionId: string
    }
  | {
      readonly operation: 'handoff'
      readonly effect: 'session-handed-off'
      readonly sessionId: string
      readonly previousWorkspaceId: string
      readonly workspaceId: string
      readonly workspaceState: 'ready' | 'pending'
    }

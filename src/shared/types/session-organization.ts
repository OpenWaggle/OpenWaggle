export type SessionHandoffWorkspaceSelection =
  | { readonly mode: 'local' }
  | { readonly mode: 'existing'; readonly workspaceId: string }
  | {
      readonly mode: 'new-worktree'
      readonly baseRef?: string
      readonly startFromOrigin?: boolean
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

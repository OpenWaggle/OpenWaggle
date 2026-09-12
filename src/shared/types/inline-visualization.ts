export interface InlineVisualizationReference {
  readonly path: string
  readonly title?: string
  readonly mode?: 'wide'
}

export interface InlineVisualizationFrameRegisterInput {
  readonly frameId: string
  readonly reducedMotion: boolean
  readonly sessionId: string
  readonly sourcePath: string
}

export interface InlineVisualizationFrameRegisterResult {
  readonly frameUrl: string
  readonly registrationId: string
}

export interface InlineVisualizationFrameUnregisterInput {
  readonly frameId: string
  readonly registrationId: string
}

export interface InlineVisualizationDownloadInput {
  readonly suggestedName: string
  readonly mimeType: string
  readonly base64Data: string
}

export interface InlineVisualizationSourceOwner {
  readonly id: string
  readonly projectPath: string | null
  readonly environmentMode?: 'local' | 'worktree'
  readonly worktreePath?: string | null
}

export type InlineVisualizationReadResult =
  | {
      readonly status: 'loaded'
      readonly contents: string
      readonly sizeBytes: number
    }
  | {
      readonly status: 'unavailable'
      readonly reason: 'invalid-path' | 'missing' | 'too-large' | 'read-failed' | 'session-missing'
    }

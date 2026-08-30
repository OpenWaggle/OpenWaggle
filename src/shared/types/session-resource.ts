import type { SessionId } from './brand'

export type SessionResourceKind =
  | 'image'
  | 'file'
  | 'link'
  | 'tool'
  | 'web-search'
  | 'site'
  | 'commit'
  | 'change-request'

export type SessionResourceActivity = 'provided' | 'read' | 'created' | 'updated'

export type SessionResourceActor = 'user' | 'agent' | 'tool' | 'extension'

export interface SessionResourceOccurrence {
  readonly id: string
  readonly nodeId: string | null
  readonly branchId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly label: string | null
  readonly createdAt: number
}

export interface SessionResource {
  readonly id: string
  readonly sessionId: SessionId
  readonly canonicalKey: string
  readonly kind: SessionResourceKind
  readonly title: string
  readonly mimeType: string | null
  readonly locator: string | null
  readonly available: boolean
  readonly isSource: boolean
  readonly isOutput: boolean
  readonly occurrences: readonly SessionResourceOccurrence[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionResourceList {
  readonly resources: SessionResource[]
  readonly backfillComplete: boolean
}

export interface SessionResourceContent {
  readonly resourceId: string
  readonly fileName: string
  readonly mimeType: string
  readonly dataBase64: string
}

export interface RecordSessionChangeRequestInput {
  readonly title: string
  readonly url: string
}

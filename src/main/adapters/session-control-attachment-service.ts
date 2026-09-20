import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { createSessionControlAttachmentService } from './session-control-attachment-storage'

const UNBOUND_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000
const MAX_UNBOUND_ATTACHMENT_BYTES_PER_OWNER = 64 * 1024 * 1024
const MAX_STORED_ATTACHMENT_BYTES_GLOBAL = 256 * 1024 * 1024

export interface AttachmentStoragePolicy {
  readonly unboundTtlMs: number
  readonly maxUnboundBytesPerOwner: number
  readonly maxStoredBytesGlobal: number
}

const DEFAULT_ATTACHMENT_STORAGE_POLICY: AttachmentStoragePolicy = {
  unboundTtlMs: UNBOUND_ATTACHMENT_TTL_MS,
  maxUnboundBytesPerOwner: MAX_UNBOUND_ATTACHMENT_BYTES_PER_OWNER,
  maxStoredBytesGlobal: MAX_STORED_ATTACHMENT_BYTES_GLOBAL,
}

export function sessionControlAttachmentServiceLayer(
  overrides: Partial<AttachmentStoragePolicy> = {},
) {
  const policy = { ...DEFAULT_ATTACHMENT_STORAGE_POLICY, ...overrides }
  return Layer.effect(
    SessionControlAttachmentService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return SessionControlAttachmentService.of(createSessionControlAttachmentService(sql, policy))
    }),
  )
}

export const LiveSessionControlAttachmentService = sessionControlAttachmentServiceLayer()

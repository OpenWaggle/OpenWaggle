import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'

export const RESOURCE: SessionResource = {
  id: 'resource-one',
  sessionId: SessionId('session-one'),
  canonicalKey: 'sha256:one',
  kind: 'image',
  title: 'output.png',
  mimeType: 'image/png',
  locator: 'session-resource://resource-one',
  managed: true,
  available: true,
  isSource: false,
  isOutput: true,
  occurrences: [],
  createdAt: 1,
  updatedAt: 1,
}

import { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceOccurrence } from '@shared/types/session-resource'
import { describe, expect, it } from 'vitest'
import { orderedSessionImages } from '../session-resource-gallery'

function occurrence(id: string, nodeId: string, activity: 'created' | 'read', createdAt: number) {
  return {
    id,
    nodeId,
    branchId: null,
    actor: 'agent',
    activity,
    label: null,
    locator: null,
    createdAt,
  } satisfies SessionResourceOccurrence
}

function image(
  id: string,
  createdAt: number,
  occurrences: readonly SessionResourceOccurrence[],
): SessionResource {
  return {
    id,
    sessionId: SessionId('session-1'),
    canonicalKey: `sha256:${id}`,
    kind: 'image',
    title: `${id}.png`,
    mimeType: 'image/png',
    locator: `session-resource://${id}`,
    managed: true,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences,
    createdAt,
    updatedAt: createdAt,
  }
}

describe('orderedSessionImages', () => {
  it('orders a deduplicated image by its first occurrence on the active transcript path', () => {
    const reusedLater = image('reused-later', 500, [
      occurrence('reused-hidden', 'hidden-message', 'created', 500),
      occurrence('reused-active', 'active-later', 'read', 3000),
    ])
    const activeEarlier = image('active-earlier', 2000, [
      occurrence('active-earlier', 'active-earlier', 'created', 2000),
    ])

    expect(
      orderedSessionImages(
        [reusedLater, activeEarlier],
        new Set(['active-earlier', 'active-later']),
      ).map((resource) => resource.id),
    ).toEqual(['active-earlier', 'reused-later'])
  })
})

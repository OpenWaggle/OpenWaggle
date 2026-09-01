import type { CodeViewHandle } from '@pierre/diffs/react'
import { type RefObject, useEffect, useRef } from 'react'
import { codeViewItemId, type ReviewAnnotationMetadata } from '../lib/code-view-items'

export interface DiffFileNavigation {
  readonly path: string
  readonly requestId: number
}

/** Retains navigation requests until progressive patch preparation reaches the requested file. */
export function usePreparedDiffFileNavigation(
  viewerRef: RefObject<CodeViewHandle<ReviewAnnotationMetadata> | null>,
  navigation: DiffFileNavigation | null,
  preparedPaths: ReadonlySet<string>,
) {
  const handledRequestId = useRef<number | null>(null)
  useEffect(() => {
    if (
      navigation === null ||
      handledRequestId.current === navigation.requestId ||
      !preparedPaths.has(navigation.path)
    ) {
      return
    }
    const viewer = viewerRef.current
    if (viewer === null) return
    viewer.scrollTo({ type: 'item', id: codeViewItemId(navigation.path), align: 'start' })
    handledRequestId.current = navigation.requestId
  }, [navigation, preparedPaths, viewerRef])
}

import { useEffect, useRef, useState } from 'react'
import type { SyntaxHighlightResult } from '@/shared/lib/syntax/protocol'
import { syntaxService } from '@/shared/lib/syntax/syntax-service'

export function useSourceViewHighlighting({
  source,
  sourceFingerprint,
  language,
  theme,
  admitted,
  lineRange,
}: {
  readonly source: string
  readonly sourceFingerprint: string
  readonly language: string
  readonly theme: string
  readonly admitted: boolean
  readonly lineRange: { readonly start: number; readonly end: number }
}) {
  const [highlighted, setHighlighted] = useState<{
    readonly source: string
    readonly language: string
    readonly lineRange: { readonly start: number; readonly end: number }
    readonly result: SyntaxHighlightResult
  } | null>(null)
  const identityController = useRef<{
    readonly source: string
    readonly language: string
    readonly theme: string
    readonly controller: AbortController
  } | null>(null)
  const requestSequence = useRef(0)

  useEffect(() => {
    return () => {
      identityController.current?.controller.abort()
      identityController.current = null
    }
  }, [])

  useEffect(() => {
    let identity = identityController.current
    if (
      !identity ||
      identity.controller.signal.aborted ||
      identity.source !== source ||
      identity.language !== language ||
      identity.theme !== theme
    ) {
      identity?.controller.abort()
      identity = { source, language, theme, controller: new AbortController() }
      identityController.current = identity
    }
    const { controller } = identity
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    if (language === 'text' || !admitted) {
      return () => {
        if (requestSequence.current === requestId) requestSequence.current += 1
      }
    }
    void syntaxService
      .highlight({
        source,
        sourceFingerprint,
        language,
        theme,
        priority: 'near-viewport',
        lineRange,
        signal: controller.signal,
      })
      .then((result) => {
        if (!controller.signal.aborted && requestSequence.current === requestId) {
          setHighlighted({ source, language, lineRange, result })
        }
      })
    return () => {
      if (requestSequence.current === requestId) requestSequence.current += 1
    }
  }, [admitted, language, lineRange, source, sourceFingerprint, theme])

  const compatible =
    highlighted?.source === source && highlighted.language === language ? highlighted : null
  const coversVisibleRange =
    compatible !== null &&
    compatible.lineRange.start <= lineRange.start &&
    compatible.lineRange.end >= lineRange.end

  return {
    result: compatible?.result ?? null,
    loading: language !== 'text' && admitted && !coversVisibleRange,
  }
}

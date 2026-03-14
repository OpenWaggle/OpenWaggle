import { useEffect, useRef, useState } from 'react'

interface FrameRef {
  current: number | null
}

function cancelPendingFrame(frameRef: FrameRef): void {
  if (frameRef.current === null) {
    return
  }

  cancelAnimationFrame(frameRef.current)
  frameRef.current = null
}

export function useThrottledStreamText(text: string, isStreaming: boolean): string {
  const [displayText, setDisplayText] = useState(text)
  const displayTextRef = useRef(text)
  const latestTextRef = useRef(text)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    latestTextRef.current = text
  }, [text])

  useEffect(() => {
    if (!isStreaming) {
      cancelPendingFrame(frameRef)

      if (displayTextRef.current !== text) {
        displayTextRef.current = text
        setDisplayText(text)
      }

      return
    }

    if (frameRef.current !== null) {
      return
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null

      const nextText = latestTextRef.current
      if (displayTextRef.current === nextText) {
        return
      }

      displayTextRef.current = nextText
      setDisplayText(nextText)
    })
  }, [isStreaming, text])

  useEffect(() => {
    return () => {
      cancelPendingFrame(frameRef)
    }
  }, [])

  return isStreaming ? displayText : text
}

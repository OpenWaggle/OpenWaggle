import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'

const FEEDBACK_DURATION_MS = 2000

interface UseCopyToClipboardResult {
  copied: boolean
  copy: (text: string) => void
}

export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  function copy(text: string): void {
    api.copyToClipboard(text)
    setCopied(true)

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setCopied(false)
      timerRef.current = null
    }, FEEDBACK_DURATION_MS)
  }

  return { copied, copy }
}

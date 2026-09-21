import type { SessionProjectPage } from '@shared/types/session'
import { useEffect, useRef, useState } from 'react'

const SEARCH_DELAY_MS = 180

export function useProjectCatalog(
  loadProjectsPage?: (cursor?: string, search?: string) => Promise<SessionProjectPage>,
) {
  const [paths, setPaths] = useState<readonly string[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [hasPaged, setHasPaged] = useState(false)
  const requestId = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      requestId.current += 1
      if (searchTimer.current) clearTimeout(searchTimer.current)
    },
    [],
  )

  async function loadPage(cursor?: string, search = '') {
    if (!loadProjectsPage) return
    const currentRequest = ++requestId.current
    setLoading(true)
    setError(false)
    try {
      const page = await loadProjectsPage(cursor, search)
      if (currentRequest !== requestId.current) return
      setPaths((previous) => (cursor ? [...previous, ...page.paths] : page.paths))
      setNextCursor(page.nextCursor ?? null)
    } catch {
      if (currentRequest === requestId.current) setError(true)
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  function cancel() {
    requestId.current += 1
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = null
    setLoading(false)
  }

  function reset(search = '') {
    cancel()
    setPaths([])
    setNextCursor(null)
    setHasPaged(false)
    setError(false)
    if (!search) {
      void loadPage()
      return
    }
    if (loadProjectsPage) {
      setLoading(true)
      searchTimer.current = setTimeout(() => void loadPage(undefined, search), SEARCH_DELAY_MS)
    }
  }

  function loadMore(search: string) {
    if (!nextCursor || loading) return
    setHasPaged(true)
    void loadPage(nextCursor, search)
  }

  function retry(search: string) {
    if (loading) return
    void loadPage(nextCursor ?? undefined, search)
  }

  return { paths, nextCursor, loading, error, hasPaged, cancel, reset, loadMore, retry }
}

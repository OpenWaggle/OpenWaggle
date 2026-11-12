import { useEffect, useState } from 'react'

const NOW_TICK_MS = 30_000

/** The current time, re-read on a slow tick so relative times ("in 5 minutes") stay true. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

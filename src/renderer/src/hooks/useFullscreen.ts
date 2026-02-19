import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'

export function useFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    return api.onFullscreenChanged(setIsFullscreen)
  }, [])

  return isFullscreen
}

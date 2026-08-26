import { useSyncExternalStore } from 'react'
import type { OpenWaggleAppearanceName } from '@/shared/lib/appearance'

const APPEARANCE_DATA_ATTRIBUTE = 'data-theme'
const DEFAULT_APPEARANCE = 'dark'

function appearanceName(): OpenWaggleAppearanceName {
  const name = document.documentElement.getAttribute(APPEARANCE_DATA_ATTRIBUTE)
  return name === 'debug' ? name : DEFAULT_APPEARANCE
}

function subscribeToAppearance(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributeFilter: [APPEARANCE_DATA_ATTRIBUTE],
    attributes: true,
  })
  return () => observer.disconnect()
}

export function useAppearanceName() {
  return useSyncExternalStore(subscribeToAppearance, appearanceName, appearanceName)
}

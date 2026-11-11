import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

declare global {
  interface Window {
    api: OpenWaggleApi
  }
}

const isElectron = typeof window !== 'undefined' && window.api !== undefined
// The build says, not the page's address: an Electrobun build serves its renderer from a loopback
// http origin, as the Vite dev server does (ADR 0064).
const isDevelopment = import.meta.env.DEV
const logLevel = 'info'

export const env = {
  isDevelopment,
  isElectron,
  logLevel,
} as const

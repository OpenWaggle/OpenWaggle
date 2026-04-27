import type { OpenWaggleApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: OpenWaggleApi
  }
}

const isElectron = typeof window !== 'undefined' && window.api !== undefined
const isDevelopment =
  typeof window !== 'undefined' &&
  window.location.protocol !== 'file:' &&
  window.location.protocol !== 'openwaggle:'
const logLevel = 'info'

export const env = {
  isDevelopment,
  isElectron,
  logLevel,
} as const

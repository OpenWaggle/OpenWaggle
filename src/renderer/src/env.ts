import type { OpenWaggleApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: OpenWaggleApi
  }
}

const isDevelopment = typeof window !== 'undefined' && window.location.protocol !== 'file:'

export const env = {
  isDevelopment,
} as const

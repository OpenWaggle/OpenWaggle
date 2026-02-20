import type { OpenHiveApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: OpenHiveApi
  }
}

const isDevelopment = typeof window !== 'undefined' && window.location.protocol !== 'file:'

export const env = {
  isDevelopment,
} as const

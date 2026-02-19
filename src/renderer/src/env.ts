import type { OpenHiveApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: OpenHiveApi
  }
}

export const env = {} as const

import type { HiveCodeApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: HiveCodeApi
  }
}

export const env = {} as const

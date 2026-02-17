/// <reference types="vite/client" />

import type { HiveCodeApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: HiveCodeApi
  }
}

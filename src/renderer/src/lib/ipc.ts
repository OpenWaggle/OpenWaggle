import type { HiveCodeApi } from '@shared/types/ipc'

/**
 * Type-safe access to the preload API.
 * The global augmentation in env.d.ts declares window.api.
 */
export const api: HiveCodeApi = window.api

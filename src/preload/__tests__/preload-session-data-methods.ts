import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** The preload methods behind bounded Session reads (B5) and the batched account read. */
export const PRELOAD_SESSION_DATA_METHODS = [
  'listTurnDiffFiles',
  'searchSessionTree',
  'getAuthAccountInfos',
] as const satisfies readonly (keyof OpenWaggleApi)[]

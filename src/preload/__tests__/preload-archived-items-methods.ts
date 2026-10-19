import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** The preload methods behind Settings > Archived items. */
export const PRELOAD_ARCHIVED_ITEMS_METHODS = [
  'queryArchivedItems',
  'listArchivedItemRefs',
  'setArchivedItems',
  'deleteArchivedSessions',
] as const satisfies readonly (keyof OpenWaggleApi)[]

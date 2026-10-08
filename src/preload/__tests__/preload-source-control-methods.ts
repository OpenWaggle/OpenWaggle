import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** Change request and source-control setup methods the preload bridge exposes (ADR 0048). */
export const PRELOAD_SOURCE_CONTROL_METHODS: readonly (keyof OpenWaggleApi)[] = [
  'preflightChangeRequest',
  'listChangeRequests',
  'checkoutChangeRequest',
  'getChangeRequestPanel',
  'mergeChangeRequest',
  'getSourceControlHosts',
  'getChangeRequestOpenDestination',
  'configureSourceControl',
  'refreshSourceControlStatus',
]

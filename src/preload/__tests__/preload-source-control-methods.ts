import type { OpenWaggleApi } from '@shared/types/openwaggle-api'

/** Source-control setup methods the preload bridge exposes (ADR 0048). */
export const PRELOAD_SOURCE_CONTROL_METHODS: readonly (keyof OpenWaggleApi)[] = [
  'getSourceControlHosts',
  'getChangeRequestOpenDestination',
  'configureSourceControl',
  'refreshSourceControlStatus',
]

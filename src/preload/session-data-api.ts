import { invoke } from './ipc-bindings'

/**
 * Bounded Session reads (v1 performance, B5) and the batched account read, kept beside api.ts for
 * its line budget.
 */
export const sessionDataApi = {
  listTurnDiffFiles: invoke('sessions:turn-diff-files:list'),
  searchSessionTree: invoke('sessions:search-tree'),
  getAuthAccountInfos: invoke('auth:get-account-infos'),
}

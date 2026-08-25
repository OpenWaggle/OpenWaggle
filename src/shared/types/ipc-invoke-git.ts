import type { RepositoryPath } from './brand'
import type { ChangeRequestCheckoutResult, ChangeRequestListResult } from './git'

/**
 * How a selected change request should be adopted.
 *
 * `checkout` switches the repository's checkout to the change-request branch. That is only what
 * the user wants when the opened checkout is also the tree the session runs in.
 *
 * `fetch` makes the ref available locally without touching any working tree. A worktree-mode
 * session only needs the ref as a base for its own tree, and switching the user's checkout as a
 * side effect was the "surface targets the wrong tree" defect ADR 0016 exists to prevent.
 */
export type ChangeRequestAdoption = 'checkout' | 'fetch'

/**
 * Git source-control invoke channels split out of ipc-invoke-integrations to
 * keep each channel-map module under the line cap.
 *
 * Change requests are repository-level: their refs live in the repository shared by every linked
 * worktree, so these channels take a `RepositoryPath` rather than a session's `WorkingPath`.
 */
export interface IpcGitInvokeChannelMap {
  'git:change-request:list': {
    args: [repositoryPath: RepositoryPath]
    return: ChangeRequestListResult
  }
  'git:change-request:checkout': {
    args: [repositoryPath: RepositoryPath, reference: string, adoption: ChangeRequestAdoption]
    return: ChangeRequestCheckoutResult
  }
}

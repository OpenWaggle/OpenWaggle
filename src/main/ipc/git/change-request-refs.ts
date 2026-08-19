/** Provider ref namespaces that expose a change request's head commit, including from a fork. */
const PROVIDER_HEAD_REF_PATTERNS = [
  // GitHub: https://github.com/owner/repo/pull/163
  { url: /\/pull\/(?<number>\d+)(?:[/?#]|$)/u, headRef: (n: string) => `refs/pull/${n}/head` },
  // GitLab: https://gitlab.com/group/repo/-/merge_requests/42
  {
    url: /\/merge_requests\/(?<number>\d+)(?:[/?#]|$)/u,
    headRef: (n: string) => `refs/merge-requests/${n}/head`,
  },
] as const

export interface ChangeRequestFetchPlan {
  /** The ref on the remote that holds the change request's head commit. */
  readonly remoteRef: string
  /** Where to store it locally, so the session can use it as a base ref. */
  readonly localRef: string
}

/**
 * How to fetch a change request's head commit.
 *
 * Derived from the change request's URL rather than its head branch name. The branch name only
 * exists on `origin` when the change request came from the same repository, so for a fork-based
 * change request - the normal shape of an outside contribution - fetching
 * `refs/heads/<headRef>` either fails outright or, worse, silently succeeds against an unrelated
 * `origin` branch that happens to share the name (`patch-1`, `main`, ...) and hands the session the
 * wrong base entirely. Both providers publish the real head under a numbered ref that works for
 * forks, which is what this targets.
 */
export function planChangeRequestFetch(changeRequestUrl: string): ChangeRequestFetchPlan | null {
  for (const pattern of PROVIDER_HEAD_REF_PATTERNS) {
    const number = pattern.url.exec(changeRequestUrl)?.groups?.['number']
    if (number !== undefined) {
      return {
        remoteRef: pattern.headRef(number),
        localRef: `refs/remotes/origin/change-requests/${number}`,
      }
    }
  }
  return null
}

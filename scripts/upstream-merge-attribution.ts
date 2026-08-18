import { isAncestor } from './git-ancestry'

/** Just enough of a commit for the attribution question. */
interface MergeCandidate {
  readonly hash: string
  readonly parentHashes: readonly string[]
}

/**
 * Merges that only bring the base branch into the PR, which need no release intent of their own.
 *
 * `bases` is every ref the containment question may reasonably be asked against, and a merge is
 * exempt when *all* of its incoming parents are contained in at least one of them. It used to be a
 * single ref taken from `effectiveFrom`, which broke as soon as the base branch advanced after the
 * sync merge: `resolveEffectiveFrom` discards a `from` that is no longer an ancestor of the PR head
 * and collapses to the bootstrap baseline, so the incoming parent was not contained and Commit
 * Policy re-blocked the PR on every later run. Reproduced before fixing.
 */
export async function collectUpstreamUpdateMergeHashes(input: {
  readonly bases: readonly string[]
  readonly commits: readonly MergeCandidate[]
  readonly cwd: string
}) {
  const upstreamMergeHashes = new Set<string>()
  const bases = [...new Set(input.bases.filter((base) => base.length > 0))]

  for (const commit of input.commits) {
    if (commit.parentHashes.length <= 1) continue
    const incomingParents = commit.parentHashes.slice(1)
    const containment = await Promise.all(
      incomingParents.map(async (parent) => {
        const results = await Promise.all(
          bases.map((base) => isAncestor(input.cwd, parent, base)),
        )
        return results.some((contained) => contained)
      }),
    )
    if (containment.every((contained) => contained)) {
      upstreamMergeHashes.add(commit.hash)
    }
  }

  return upstreamMergeHashes
}

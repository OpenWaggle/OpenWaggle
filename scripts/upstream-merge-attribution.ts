import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { isAncestor } from './git-ancestry'

const execFile = promisify(execFileCallback)

/** Just enough of a commit for the attribution question. */
interface MergeCandidate {
  readonly hash: string
  readonly parentHashes: readonly string[]
}

/** The published surface: a change here must carry release intent. */
const PUBLISHABLE_PREFIX = 'packages/'

/**
 * Paths in a merge commit that differ from *every* parent.
 *
 * A merge's tree is not constrained by its parents: content introduced while resolving conflicts -
 * an "evil merge" - exists in neither side. `git diff-tree -c -r` reports exactly that set, so it is
 * the only part of a merge the branch genuinely owns. Verified against a scratch repository where a
 * new `packages/` file added during a sync merge appears here while `diff vs first parent` also lists
 * unrelated base-branch changes.
 */
async function evilMergePaths(cwd: string, hash: string): Promise<readonly string[]> {
  const { stdout } = await execFile('git', ['diff-tree', '-c', '-r', '--name-only', hash], { cwd })
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== hash)
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
 *
 * Containment alone is not sufficient, though. It says where the *parents* are, not what the merge
 * commit contains, so a `packages/` change made while resolving a conflict - present in no parent
 * and released nowhere - was dropped from both the commit rule and the PR-title rule. That is how a
 * change to the published npm surface could reach the base branch with no version bump and no
 * changelog entry. A merge that introduces such a path is therefore not exempt, however well its
 * parents are contained.
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
        const results = await Promise.all(bases.map((base) => isAncestor(input.cwd, parent, base)))
        return results.some((contained) => contained)
      }),
    )
    if (!containment.every((contained) => contained)) continue

    const introduced = await evilMergePaths(input.cwd, commit.hash)
    if (introduced.some((path) => path.startsWith(PUBLISHABLE_PREFIX))) continue

    upstreamMergeHashes.add(commit.hash)
  }

  return upstreamMergeHashes
}

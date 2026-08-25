import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { isAncestor } from './git-ancestry'

const execFile = promisify(execFileCallback)

/** Just enough of a commit for the attribution question. */
interface MergeCandidate {
  readonly hash: string
  readonly parentHashes: readonly string[]
  readonly changedPaths: readonly string[]
}

/** The published surface: a change here must carry release intent. */
const PUBLISHABLE_PREFIX = 'packages/'

/** Paths a commit changed relative to its first parent, read raw so quoting cannot hide a prefix. */
async function blobAt(cwd: string, commitish: string, filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', `${commitish}:${filePath}`], { cwd })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Whether every published-package path this merge touches already has the merge's content on a base.
 *
 * This is the question the exemption is really asking: "are these changes already released on the
 * base branch?" Earlier versions asked it indirectly and both were evadable. Parent containment alone
 * ignored what the merge commit *contains*, so content introduced while resolving a conflict was
 * exempt. Asking `git diff-tree -c -r` for paths that differ from every parent was better but still
 * evadable: a combined diff omits a path whenever the result matches *any* parent, and containment
 * accepts any ancestor of the base - so merging an old released commit and resolving a published file
 * back to that older content produced an empty combined diff and passed.
 *
 * Comparing the blob against the base answers it directly: identical means the base already has
 * exactly this content, whatever route it took; different means this merge is changing the published
 * surface and owes release intent.
 *
 * The merge's own parents are asked as well, and they are what makes the answer stable. A base ref is the
 * base branch's *current tip*, which moves: a sync merge that legitimately brought release 0.2.0 stopped
 * matching the moment the base released 0.3.0 of the same file - which is every release, since release-please
 * rewrites `package.json` and `CHANGELOG.md` each time. The PR was then permanently blocked by a commit-level
 * violation that no title can satisfy, and re-syncing only added another such merge. A parent cannot move,
 * and content that equals a parent's is by definition not introduced by this merge.
 */
async function publishedChangesMatchBase(
  cwd: string,
  commit: MergeCandidate,
  bases: readonly string[],
): Promise<boolean> {
  const publishedPaths = commit.changedPaths.filter((path) => path.startsWith(PUBLISHABLE_PREFIX))
  if (publishedPaths.length === 0) return true

  const references = [...bases, ...commit.parentHashes]
  for (const filePath of publishedPaths) {
    const merged = await blobAt(cwd, commit.hash, filePath)
    const referenceBlobs = await Promise.all(
      references.map((reference) => blobAt(cwd, reference, filePath)),
    )
    if (!referenceBlobs.includes(merged)) return false
  }
  return true
}

/**
 * Merges that only bring the base branch into the PR, which need no release intent of their own.
 *
 * `bases` is every ref the containment question may reasonably be asked against, and a merge is
 * exempt when *all* of its incoming parents are contained in at least one of them. It used to be a
 * single ref taken from `effectiveFrom`, which broke as soon as the base branch advanced after the
 * sync merge: `resolveEffectiveFrom` discards a `from` that is no longer an ancestor of the PR head
 * and collapses to the bootstrap baseline, so the incoming parent was not contained and Commit Policy
 * re-blocked the PR on every later run. Reproduced before fixing.
 *
 * Containment is necessary but not sufficient: it describes where the parents are, not what the merge
 * contains. The exemption therefore also requires every published-package path the merge touches to
 * already hold that exact content on a base.
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
    if (!(await publishedChangesMatchBase(input.cwd, commit, bases))) continue

    upstreamMergeHashes.add(commit.hash)
  }

  return upstreamMergeHashes
}

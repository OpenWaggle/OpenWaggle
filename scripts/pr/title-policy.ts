import { validateConventionalCommits } from '../check-conventional-commits'
import { optionalCommandOutput } from './cli'

/**
 * Runs the same commit-policy check CI runs on a PR, title included: GitHub squashes with the
 * PR title as the commit subject, so a title that fails the policy fails the Commit Policy job.
 * Scoped to this branch's commits through the merge base with `origin/<base>`.
 */
export async function titlePolicyViolations(input: {
  readonly base: string
  readonly title: string
}) {
  const baseline = optionalCommandOutput('git', ['merge-base', 'HEAD', `origin/${input.base}`])
  const result = await validateConventionalCommits({
    ...(baseline === undefined ? {} : { baseline }),
    missingReleaseHistory: 'skip',
    prTitle: input.title,
  })
  return result.violations
}

/**
 * The force-push rule for one `git push`: `--force`, `-f`, `--mirror`, a `+refspec` and
 * `--force-with-lease` are blocked, except a lease naming the expected sha of an agent's own
 * `ow/*` PR branch, which replays that branch onto a moved `main`
 * (`git push --force-with-lease=ow/x:<sha> origin HEAD:ow/x`). The caller says whether the push
 * was written out with no alias or git config on the way, the only route the exception takes.
 */
import { type LongOption, type ParsedArgs, isAbbreviation } from './args'
import type { GuardrailHit } from './hits'

const BRANCH_REF_PREFIX = 'refs/heads/'
/** The prefix of the PR branches OpenWaggle's agents push, the only ones a lease may rewrite. */
const AGENT_BRANCH_PREFIX = 'ow/'
/** A lease's expected value, written as an object name rather than a ref git resolves. */
const EXPECTED_SHA = /^[0-9a-f]{7,64}$/i
const FORCE_WITH_LEASE_SHORTEST = '--force-w'.length
const MIRROR_SHORTEST = '--mi'.length
const DRY_RUN_SHORTEST = '--d'.length

export function forcePushHits(
  { short, long, longOptions, positionals }: ParsedArgs,
  leaseAllowed: boolean,
) {
  // A dry run pushes nothing, so it rewrites nothing.
  if (short.has('n') || long.some((flag) => isAbbreviation(flag, '--dry-run', DRY_RUN_SHORTEST))) {
    const hit: GuardrailHit[] = []
    return hit
  }
  const refspecs = positionals.slice(1)
  const forced =
    short.has('f') ||
    long.includes('--force') ||
    long.some((flag) => isAbbreviation(flag, '--mirror', MIRROR_SHORTEST)) ||
    refspecs.some((spec) => spec.startsWith('+'))
  const leases = longOptions.filter((option) =>
    isAbbreviation(option.name, '--force-with-lease', FORCE_WITH_LEASE_SHORTEST),
  )
  const leaseRefused =
    leases.length > 0 && !(leaseAllowed && leasesOnlyAgentBranches(leases, refspecs))
  const hit: GuardrailHit[] =
    forced || leaseRefused
      ? [
          {
            rule: 'force-push',
            title:
              'A force push (--force, --mirror, a +refspec, or a --force-with-lease other than <ow/branch>:<expected sha> for the ow/* branch it pushes).',
          },
        ]
      : []
  return hit
}

/**
 * Whether every refspec pushes to an `ow/*` branch and every lease is `<ref>:<sha>` for one of
 * those branches, with the sha written out.
 */
function leasesOnlyAgentBranches(leases: readonly LongOption[], refspecs: readonly string[]) {
  const destinations = refspecs.map((spec) => agentBranchRef(spec.slice(spec.indexOf(':') + 1)))
  if (destinations.length === 0 || destinations.includes(undefined)) {
    return false
  }
  return leases.every(({ value = '' }) => {
    const separator = value.indexOf(':')
    return (
      separator !== -1 &&
      destinations.includes(agentBranchRef(value.slice(0, separator))) &&
      EXPECTED_SHA.test(value.slice(separator + 1))
    )
  })
}

/** `ow/x` or `refs/heads/ow/x` as `refs/heads/ow/x`; undefined for any other ref or a pattern. */
function agentBranchRef(ref: string) {
  const branch = ref.startsWith(BRANCH_REF_PREFIX) ? ref.slice(BRANCH_REF_PREFIX.length) : ref
  return branch.startsWith(AGENT_BRANCH_PREFIX) &&
    branch.length > AGENT_BRANCH_PREFIX.length &&
    !branch.includes('*')
    ? `${BRANCH_REF_PREFIX}${branch}`
    : undefined
}

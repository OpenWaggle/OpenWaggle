import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  currentHeadSha,
  flagValue,
  hasFlag,
  isWorkingTreeClean,
  normalizeArgs,
  PrScriptError,
  reportFailure,
  runInherited,
  upstreamSha,
} from './cli'
import { runReadyGate } from './gate'
import { viewerLogin, viewPullRequest } from './github'
import { computeBlastRadius, publishReadyRecord } from './ready-publish'
import { reviewEvidenceViolations, reviewedShaViolations } from './review-evidence'

const USER_ARGS_START_INDEX = 2
const VALUE_FLAGS = new Set(['--reviewed-sha', '--review-file'])

function printHelp() {
  console.log(`Usage: bun run pr:ready -- [pr] --reviewed-sha <sha> --review-file <path> [--dry-run]

Marks a draft PR ready after an independent review of the exact HEAD.

  pr              PR number, URL or branch; defaults to the current branch's PR
  --reviewed-sha  Full SHA the fresh-context reviewer reviewed; must equal HEAD and the PR head
  --review-file   Converged review summary (rounds, P0-P3, dispositions) with a reviewed-sha line
  --dry-run       Run the checks and the gate, write .tmp/pr/ files, change nothing on GitHub

Runs bun run check, test and build, publishes the blast radius (PR body section and a sticky
comment), posts the review evidence comment, then runs gh pr ready.`)
}

function positionalSelector(args: readonly string[]) {
  return args.find(
    (argument, index) =>
      !argument.startsWith('-') && (index === 0 || !VALUE_FLAGS.has(args[index - 1] ?? '')),
  )
}

function readEvidence(file: string | undefined) {
  if (file === undefined) {
    throw new PrScriptError('--review-file is required: the converged review summary to post.')
  }
  return readFileSync(path.resolve(file), 'utf8')
}

function assertSynced() {
  if (!isWorkingTreeClean()) {
    throw new PrScriptError('The working tree is dirty. Commit and push, then review again.')
  }
  const head = currentHeadSha()
  if (upstreamSha() !== head) {
    throw new PrScriptError('HEAD differs from its upstream. Push, then review again.')
  }
  return head
}

function main() {
  const args = normalizeArgs(process.argv.slice(USER_ARGS_START_INDEX))
  if (hasFlag(args, '--help', '-h')) {
    printHelp()
    return
  }
  const dryRun = hasFlag(args, '--dry-run')
  const reviewedSha = flagValue(args, '--reviewed-sha')
  const evidence = readEvidence(flagValue(args, '--review-file'))
  const headSha = assertSynced()
  const pr = viewPullRequest(positionalSelector(args))
  if (pr.state !== 'OPEN') {
    throw new PrScriptError(`PR #${String(pr.number)} is ${pr.state.toLowerCase()}.`)
  }
  const violations = [
    ...reviewedShaViolations({ headSha, prHeadSha: pr.headRefOid, reviewedSha }),
    ...reviewEvidenceViolations(evidence, reviewedSha ?? ''),
  ]
  if (violations.length > 0) {
    throw new PrScriptError(violations.join('\n'))
  }
  if (!runReadyGate()) {
    throw new PrScriptError('The gate failed; PR left as it was.')
  }
  if (currentHeadSha() !== headSha || !isWorkingTreeClean()) {
    throw new PrScriptError(
      'The gate changed HEAD or the working tree. Commit, push, review again.',
    )
  }
  // Read the PR again: the gate takes minutes, and the body or head may have moved meanwhile.
  const current = viewPullRequest(String(pr.number))
  if (current.headRefOid !== headSha) {
    throw new PrScriptError(
      `The PR head moved to ${current.headRefOid} during the gate. Review again.`,
    )
  }
  const blastRadius = computeBlastRadius({ base: pr.baseRefName, headSha })
  console.log(
    `blast radius: ${blastRadius.risk} risk, ${String(blastRadius.changedFileCount)} files (${blastRadius.reportPath})`,
  )
  if (dryRun) {
    console.log(
      `dry-run: would publish the blast radius and review evidence on ${pr.url}, then gh pr ready`,
    )
    return
  }
  const { reportUrl, reviewUrl } = publishReadyRecord({
    blastRadius,
    evidence,
    pr: current,
    viewer: viewerLogin(),
  })
  console.log(`blast-radius comment: ${reportUrl}\nreview evidence: ${reviewUrl}`)
  if (pr.isDraft && !runInherited('gh', ['pr', 'ready', String(pr.number)])) {
    throw new PrScriptError('gh pr ready failed after publishing; run it again or check GitHub.')
  }
  console.log(`pr:ready: ${pr.url} is ready for review. Next: /babysit.`)
}

try {
  main()
} catch (error: unknown) {
  reportFailure('pr:ready', error)
}

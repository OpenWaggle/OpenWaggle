import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  commandOutput,
  currentBranch,
  currentHeadSha,
  isWorkingTreeClean,
  normalizeArgs,
  optionalCommandOutput,
  PrScriptError,
  reportFailure,
  runInherited,
  upstreamSha,
} from './cli'
import {
  buildGhCreateArgs,
  isHelpRequest,
  missingTemplateHeadings,
  PULL_REQUEST_TEMPLATE_PATH,
  parseCreateArgs,
} from './create-args'
import { titlePolicyViolations } from './title-policy'

const USER_ARGS_START_INDEX = 2

function printHelp() {
  console.log(`Usage: bun run pr:create -- --title "<conventional subject>" --body-file <path> [gh pr create flags]

Creates a draft GitHub PR against main from the pushed current branch.

  --title, -t       PR title. It becomes the squash commit subject, so it must pass the commit policy.
  --body-file, -F   Body written from ${PULL_REQUEST_TEMPLATE_PATH}; every template ## heading must stay.
  --base, -B        Base branch (default main).

Other gh pr create flags (--label, --reviewer, --assignee) pass through. The PR is always a draft.`)
}

function readBody(bodyFile: string) {
  // `bun run` starts scripts in the repository root, so a relative path resolves from there.
  const resolved = path.resolve(bodyFile)
  const body = readFileSync(resolved, 'utf8')
  if (body.trim().length === 0) {
    throw new PrScriptError(`${bodyFile} is empty.`)
  }
  return { body, resolved }
}

function assertBranchIsPushed(base: string) {
  const branch = currentBranch()
  if (branch === base || branch === 'HEAD') {
    throw new PrScriptError(`Current branch is ${branch}; create a feature branch first.`)
  }
  const upstream = upstreamSha()
  if (upstream === undefined) {
    throw new PrScriptError(
      `${branch} has no upstream. Push it first: git push -u origin ${branch}`,
    )
  }
  if (upstream !== currentHeadSha()) {
    throw new PrScriptError(
      `${branch} differs from its upstream. Push it first (hooks run on push).`,
    )
  }
  if (!isWorkingTreeClean()) {
    console.warn('pr:create: the working tree has uncommitted changes; they are not in the PR.')
  }
  return branch
}

function assertNoOpenPr(branch: string) {
  const existing = optionalCommandOutput('gh', [
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'url',
    '--jq',
    '.[0].url // empty',
  ])
  if (existing !== undefined && existing.length > 0) {
    throw new PrScriptError(`${branch} already has an open PR: ${existing}`)
  }
}

async function main() {
  const args = normalizeArgs(process.argv.slice(USER_ARGS_START_INDEX))
  if (isHelpRequest(args)) {
    printHelp()
    return
  }
  const request = parseCreateArgs(args)
  const { body, resolved } = readBody(request.bodyFile)
  const template = readFileSync(PULL_REQUEST_TEMPLATE_PATH, 'utf8')
  const missing = missingTemplateHeadings(template, body)
  if (missing.length > 0) {
    throw new PrScriptError(
      `The body is missing template sections: ${missing.join(', ')}. Start from ${PULL_REQUEST_TEMPLATE_PATH}.`,
    )
  }
  const branch = assertBranchIsPushed(request.base)
  assertNoOpenPr(branch)
  const violations = await titlePolicyViolations({ base: request.base, title: request.title })
  if (violations.length > 0) {
    throw new PrScriptError(`commit policy failed:\n${violations.join('\n')}`)
  }
  if (!runInherited('gh', buildGhCreateArgs({ ...request, bodyFile: resolved }))) {
    throw new PrScriptError('gh pr create failed; check GitHub before retrying.')
  }
  console.log(
    `pr:create: draft PR for ${branch} at ${commandOutput('git', ['rev-parse', '--short', 'HEAD'])}`,
  )
}

void main().catch((error: unknown) => {
  reportFailure('pr:create', error)
})

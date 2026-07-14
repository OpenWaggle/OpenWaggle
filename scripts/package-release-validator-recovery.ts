import { runsCommandFragment } from './package-release-validator-workflow-structure'
import {
  workflowJobCondition,
  workflowJobNeeds,
  workflowJobRunCommands,
} from './package-release-validator-workflow-steps'

const EMPTY_COUNT = 0
const EXPECTED_PUBLISH_COMMAND_COUNT = 2
const WORKFLOW_PATH = '.github/workflows/package-release.yml'

const RECOVERY_JOBS = [
  {
    name: 'release-qa',
    condition: "${{ always() && needs.release-plan.result == 'success' }}",
    message: `${WORKFLOW_PATH} release-qa must run after skipped Release Please during recovery.`,
  },
  {
    name: 'prepare-artifacts',
    condition: "${{ always() && needs.release-plan.result == 'success' && needs.release-qa.result == 'success' }}",
    message: `${WORKFLOW_PATH} prepare-artifacts must run after successful recovery QA.`,
  },
  {
    name: 'publish-bases',
    condition: "${{ always() && needs.release-plan.result == 'success' && needs.prepare-artifacts.result == 'success' && needs.release-plan.outputs.has_bases == 'true' }}",
    message: `${WORKFLOW_PATH} publish-bases must run after successful recovery artifact preparation.`,
  },
] as const

const OUTCOME_CONDITION = "${{ always() && needs.release-plan.result == 'success' }}"
const OUTCOME_NEEDS = ['release-plan', 'release-qa', 'prepare-artifacts', 'publish-bases', 'publish-dependents'] as const
const OUTCOME_AUDIT = `set -euo pipefail
case "$HAS_BASES" in
  true|false) ;;
  *) echo "Invalid has_bases release-plan output: $HAS_BASES"; exit 1 ;;
esac
case "$HAS_DEPENDENTS" in
  true|false) ;;
  *) echo "Invalid has_dependents release-plan output: $HAS_DEPENDENTS"; exit 1 ;;
esac
if [ "$HAS_BASES" != "true" ] && [ "$HAS_DEPENDENTS" != "true" ]; then
  echo "Release plan did not select a package family."
  exit 1
fi

test "$RELEASE_QA_RESULT" = "success"
test "$PREPARE_ARTIFACTS_RESULT" = "success"

if [ "$HAS_BASES" = "true" ]; then
  test "$PUBLISH_BASES_RESULT" = "success"
else
  test "$PUBLISH_BASES_RESULT" = "skipped"
fi

if [ "$HAS_DEPENDENTS" = "true" ]; then
  test "$PUBLISH_DEPENDENTS_RESULT" = "success"
else
  test "$PUBLISH_DEPENDENTS_RESULT" = "skipped"
fi`

function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

export function validateWorkflowRecovery(
  workflowRoot: unknown,
  workflowText: string,
  violations: string[],
) {
  const canonicalTag = runsCommandFragment(workflowText, '^(extension-sdk|extension-react|waggle-core|pi-waggle)-v(0|[1-9][0-9]*)')
  const resolvesTag = runsCommandFragment(workflowText, 'git rev-parse "refs/tags/${tag}^{commit}"') || runsCommandFragment(workflowText, 'git rev-parse "refs/tags/${RECOVERY_TAG}^{commit}"')
  addViolation(!canonicalTag || !resolvesTag, `${WORKFLOW_PATH} must recover only one exact canonical package tag.`, violations)
  addViolation(!/^\s+ref: refs\/tags\/\$\{\{ inputs\.package_tag \}\}\s*$/m.test(workflowText), `${WORKFLOW_PATH} recovery must checkout the exact tag ref.`, violations)
  const remoteTagVerified = runsCommandFragment(workflowText, 'git ls-remote --exit-code origin "refs/tags/$RECOVERY_TAG"') && (runsCommandFragment(workflowText, '"$REMOTE_TAG_SHA" != "$SOURCE_SHA"') || runsCommandFragment(workflowText, 'test "$REMOTE_TAG_SHA" = "$SOURCE_SHA"'))
  addViolation(!remoteTagVerified, `${WORKFLOW_PATH} recovery must verify the remote GitHub tag SHA.`, violations)
  const sourceVersionVerified = workflowText.includes('test "$actual_version" = "$RECOVERY_VERSION"') || (workflowText.includes('actual_version=$(node') && workflowText.includes('"$actual_version" != "$version"'))
  addViolation(!sourceVersionVerified, `${WORKFLOW_PATH} recovery must verify source package version correspondence.`, violations)
  addViolation(!runsCommandFragment(workflowText, 'gh api "repos/$GITHUB_REPOSITORY/releases/tags/$tag"'), `${WORKFLOW_PATH} recovery must verify the exact GitHub Release.`, violations)
  addViolation((workflowText.match(/is already published\./g)?.length ?? EMPTY_COUNT) < EXPECTED_PUBLISH_COMMAND_COUNT, `${WORKFLOW_PATH} recovery must refuse already-published versions.`, violations)

  for (const job of RECOVERY_JOBS) {
    addViolation(
      workflowJobCondition(workflowRoot, job.name) !== job.condition,
      job.message,
      violations,
    )
  }

  const outcomeNeeds = workflowJobNeeds(workflowRoot, 'verify-release-outcome')
  const outcomeRuns = workflowJobRunCommands(workflowRoot, 'verify-release-outcome')
  const outcomeIsExact = workflowJobCondition(workflowRoot, 'verify-release-outcome') === OUTCOME_CONDITION &&
    outcomeNeeds.length === OUTCOME_NEEDS.length &&
    OUTCOME_NEEDS.every((jobName) => outcomeNeeds.includes(jobName)) &&
    outcomeRuns.length === 1 && outcomeRuns[0]?.trim() === OUTCOME_AUDIT
  addViolation(!outcomeIsExact, `${WORKFLOW_PATH} release outcome audit must match its exact fail-closed contract.`, violations)
}

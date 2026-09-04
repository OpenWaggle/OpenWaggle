import {
  executableWorkflowText,
  parsePackageReleaseWorkflow,
  workflowAstContractHash,
  workflowUsesYamlReferences,
} from './package-release-validator-workflow-structure'
import {
  DIRECT_NODE,
  addViolation,
  requireText,
  validateYaml,
  workflowJobBlock,
} from './package-release-validator-shared'
import { validateCiWorkflow } from './package-release-validator-ci'

const WORKFLOW_PATH = '.github/workflows/package-release.yml'
const PACKAGE_RELEASE_WORKFLOW_AST_CONTRACT =
  'f988bd6f05e6b75d2270694bfd30e558e5a09db606b7f6f1c94b3a5a1a9ba090'

const EXPECTED_PACKAGE_PATHS = [
  'packages/extension-sdk',
  'packages/extension-react',
  'packages/waggle-core',
  'packages/pi-waggle',
] as const

function validatePackageReleaseWorkflow(
  workflowText: string, promoteSource: string,
  artifactsSource: string, locatorSource: string, contextSource: string,
  violations: string[],
) {
  const parsed = parsePackageReleaseWorkflow(workflowText)
  validateYaml(WORKFLOW_PATH, workflowText, violations)
  addViolation(
    parsed.errors.length > 0 ||
      workflowUsesYamlReferences(parsed.root) ||
      workflowAstContractHash(parsed.root) !== PACKAGE_RELEASE_WORKFLOW_AST_CONTRACT,
    `${WORKFLOW_PATH} must match its exact fail-closed AST contract.`,
    violations,
  )
  const releasePlease = workflowJobBlock(workflowText, 'release-please')
  const releasePlan = workflowJobBlock(workflowText, 'release-plan')
  const publish = workflowJobBlock(workflowText, 'publish')
  for (const packagePath of EXPECTED_PACKAGE_PATHS) {
    addViolation(!workflowText.includes(`${packagePath}/**`), `${WORKFLOW_PATH} must trigger for ${packagePath}/**.`, violations)
  }
  addViolation(
    workflowText.includes('fromJSON(steps.release.outputs.pr)'),
    `${WORKFLOW_PATH} must not eagerly parse optional Release Please outputs.`,
    violations,
  )
  requireText(releasePlease, [
    ["if: github.event_name == 'push'", `${WORKFLOW_PATH} Release Please maintenance must run only for package-changing pushes.`],
    ['skip-github-release: true', `${WORKFLOW_PATH} Release Please must create version PRs without tags or GitHub Releases.`],
    ['contents: write', `${WORKFLOW_PATH} Release Please must update its coordinated PR.`],
    ['pull-requests: write', `${WORKFLOW_PATH} Release Please must update its coordinated PR.`],
    ['actions: write', `${WORKFLOW_PATH} Release Please must dispatch exact-head CI when token-created PR checks cannot run.`],
    ['PR_JSON: ${{ steps.release.outputs.pr }}', `${WORKFLOW_PATH} Release Please must decode its optional PR output only inside a guarded step.`],
    ['head_branch=$HEAD_BRANCH', `${WORKFLOW_PATH} Release Please must expose the guarded release branch output.`],
    ['pnpm package-docs:update', `${WORKFLOW_PATH} Release Please must generate the versioned documentation line before validation.`],
    ['git commit -m "fix(packages): synchronize release documentation"', `${WORKFLOW_PATH} Release Please must commit generated documentation to its exact head.`],
    ['git push origin "HEAD:$RELEASE_PR_HEAD"', `${WORKFLOW_PATH} Release Please must validate the generated documentation commit.`],
    ['repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/dispatches', `${WORKFLOW_PATH} Release Please must dispatch immutable exact-head CI.`],
    ['gh run watch "$RUN_ID" --exit-status', `${WORKFLOW_PATH} Release Please must wait for exact-head CI success.`],
  ], violations)
  requireText(workflowText, [
    ['workflow_dispatch:', `${WORKFLOW_PATH} must expose an explicit package release recovery dispatch.`],
    ['release_sha:', `${WORKFLOW_PATH} recovery must require an exact merged release SHA.`],
    [`${DIRECT_NODE} scripts/package-release-plan.ts`, `${WORKFLOW_PATH} must detect version changes through the typed tree plan.`],
    ['cancel-in-progress: false', `${WORKFLOW_PATH} must serialize and preserve in-progress package publication.`],
  ], violations)
  requireText(releasePlan, [
    ['fetch-depth: 0', `${WORKFLOW_PATH} release planning must fetch full history for multi-commit rebase merges.`],
    ['node-version: 24.14.0', `${WORKFLOW_PATH} release planning must pin Node 24.14.0.`],
    ['node --version | grep -Fx v24.14.0', `${WORKFLOW_PATH} release planning must require Node 24.14.0 before executing the plan.`],
    [`${DIRECT_NODE} scripts/package-release-context.ts`, `${WORKFLOW_PATH} must resolve push and recovery identity through the typed release context.`],
    ['RECOVERY_RELEASE_SHA: ${{ inputs.release_sha }}', `${WORKFLOW_PATH} release planning must bind recovery to the explicit release commit.`],
  ], violations)
  requireText(publish, [
    ['always() && needs.release-plan.result ==', `${WORKFLOW_PATH} publication must evaluate the successful plan even when recovery skips Release Please maintenance.`],
    ["github.event_name == 'workflow_dispatch' && needs.release-please.result == 'skipped'", `${WORKFLOW_PATH} recovery publication must require deliberately skipped Release Please maintenance.`],
    ['environment: npm', `${WORKFLOW_PATH} publication must use the protected npm environment.`],
    ['actions: read', `${WORKFLOW_PATH} publication must read the exact successful CI artifact.`],
    ['attestations: read', `${WORKFLOW_PATH} publication must verify GitHub provenance.`],
    ['contents: write', `${WORKFLOW_PATH} publication must create immutable tags and GitHub Releases after npm acceptance.`],
    ['id-token: write', `${WORKFLOW_PATH} publication must use npm Trusted Publishing through GitHub OIDC.`],
    ['node-version: 24.14.0', `${WORKFLOW_PATH} publication must pin Node 24.14.0.`],
    ['package-manager-cache: false', `${WORKFLOW_PATH} publication must not restore package-manager state.`],
    ['npm install --global npm@11.18.0', `${WORKFLOW_PATH} publication must install the pinned trusted-publishing npm runtime.`],
    ['test "$(npm --version)" = "11.18.0"', `${WORKFLOW_PATH} publication must verify the pinned trusted-publishing npm runtime.`],
    [`${DIRECT_NODE} scripts/package-release-artifact-locator.ts`, `${WORKFLOW_PATH} must locate the exact successful PR artifact by tree.`],
    ['github-token: ${{ github.token }}', `${WORKFLOW_PATH} must download cross-run artifacts using only GITHUB_TOKEN.`],
    ['run-id: ${{ steps.artifact.outputs.run_id }}', `${WORKFLOW_PATH} must download from the exact successful CI run.`],
    ['EXPECTED_ARTIFACT_SOURCE_SHA: ${{ steps.artifact.outputs.source_sha }}', `${WORKFLOW_PATH} must bind artifact provenance to its PR head SHA.`],
    ['RECOVERY_RELEASE_SHA: ${{ inputs.release_sha }}', `${WORKFLOW_PATH} recovery promotion must bind to the explicit merged release SHA.`],
    [`${DIRECT_NODE} scripts/package-release-promote.ts`, `${WORKFLOW_PATH} must promote only through the typed artifact promoter.`],
  ], violations)
  const forbiddenWorkflowText = executableWorkflowText(workflowText)
  for (const forbidden of ['npm stage', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'gh pr merge', 'enablePullRequestAutoMerge']) {
    addViolation(forbiddenWorkflowText.includes(forbidden), `${WORKFLOW_PATH} must not contain ${forbidden}.`, violations)
  }
  for (const forbidden of ['pnpm install', 'pnpm check', 'build:packages', 'package:smoke', 'website:', 'docs:generate', 'playwright', 'tsx ']) {
    addViolation(publish.includes(forbidden), `${WORKFLOW_PATH} post-merge publication must not execute ${forbidden}.`, violations)
  }
  addViolation(/continue-on-error:\s*true/.test(workflowText), `${WORKFLOW_PATH} must not fail open.`, violations)
  addViolation((workflowText.match(/id-token: write/g)?.length ?? 0) !== 1, `${WORKFLOW_PATH} must reserve OIDC permission for the single publication job.`, violations)

  requireText(promoteSource, [
    ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'package-release-promote.ts must verify the GitHub OIDC environment.'],
    ["environment.eventName === 'workflow_dispatch'", 'package-release-promote.ts must recognize only explicit recovery dispatches.'],
    ['environment.recoveryReleaseSha', 'package-release-promote.ts must bind recovery to the planned source SHA.'],
    ['verifyPackageReleaseArtifactProvenance', 'package-release-promote.ts must verify artifact provenance.'],
    ['has different integrity on npm', 'package-release-promote.ts must fail closed on registry byte substitution.'],
    ['isTransientPublicationFailure', 'package-release-promote.ts must retry only transient publication failures.'],
    ['await dependencies.ensureTag', 'package-release-promote.ts must create immutable tags after npm acceptance.'],
    ['await dependencies.ensureGitHubRelease', 'package-release-promote.ts must create GitHub Releases after npm acceptance.'],
    ["'--disable-warning=MODULE_TYPELESS_PACKAGE_JSON'", 'package-release-promote.ts must invoke the publisher without Node module-type warnings.'],
  ], violations)
  requireText(artifactsSource, [
    ["createHash('sha256')", 'package-release-artifacts.ts must record exact SHA-256 hashes.'],
    ["createHash('sha512')", 'package-release-artifacts.ts must record npm integrity hashes.'],
    ['unexpected entry', 'package-release-artifacts.ts must enforce a strict tarball allowlist.'],
    ['releaseNotes', 'package-release-artifacts.ts must preserve package-specific release notes.'],
  ], violations)
  requireText(locatorSource, [
    ["event === 'pull_request'", 'package-release-artifact-locator.ts must accept pull-request CI artifacts.'],
    ["event === 'workflow_dispatch'", 'package-release-artifact-locator.ts must accept exact-SHA dispatched CI artifacts.'],
    ["run.path === '.github/workflows/ci.yml'", 'package-release-artifact-locator.ts must accept only CI workflow artifacts.'],
    ["run.conclusion === 'success'", 'package-release-artifact-locator.ts must accept only successful CI artifacts.'],
  ], violations)
  requireText(contextSource, [
    ["input.ref !== 'refs/heads/main'", 'package-release-context.ts must allow package publication only from main.'],
    ["'origin/main'", 'package-release-context.ts must require recovery commits to be reachable from origin/main.'],
    ['COMMIT_SHA_PATTERN', 'package-release-context.ts must require canonical immutable commit SHAs.'],
    ['dependencies.resolveCommit', 'package-release-context.ts must resolve the exact recovery commit object.'],
    ['dependencies.isAncestorOfMain', 'package-release-context.ts must verify recovery commit ancestry.'],
    ["'rev-list'", 'package-release-context.ts must locate the package version commit on first-parent history.'],
    ['PACKAGE_MANIFEST_PATHSPEC', 'package-release-context.ts must derive recovery from package manifests.'],
    ['dependencies.readReleaseParent', 'package-release-context.ts must derive the pre-release parent.'],
  ], violations)
}


export function validatePackageReleasePipelines(input: Readonly<{
  artifactsSource: string
  ciWorkflowText: string
  contextSource: string
  locatorSource: string
  promoteSource: string
  workflowText: string
}>, violations: string[]) {
  validateCiWorkflow(input.ciWorkflowText, violations)
  validatePackageReleaseWorkflow(
    input.workflowText,
    input.promoteSource,
    input.artifactsSource,
    input.locatorSource,
    input.contextSource,
    violations,
  )
}

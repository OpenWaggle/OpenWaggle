import {
  executableWorkflowText,
  parsePackageReleaseWorkflow,
  workflowActionUses,
} from './package-release-validator-workflow-structure'

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
const WORKFLOW_PATH = '.github/workflows/package-release.yml'
const DIRECT_NODE = 'node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON'

const EXPECTED_PACKAGE_PATHS = [
  'packages/extension-sdk',
  'packages/extension-react',
  'packages/waggle-core',
  'packages/pi-waggle',
] as const

const APPROVED_ACTIONS = [
  { name: 'actions/attest-build-provenance', sha: '977bb373ede98d70efdf65b84cb5f73e068dcc2a', version: 'v3' },
  { name: 'actions/checkout', sha: 'df4cb1c069e1874edd31b4311f1884172cec0e10', version: 'v6' },
  { name: 'actions/download-artifact', sha: '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', version: 'v8' },
  { name: 'actions/setup-node', sha: '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e', version: 'v6' },
  { name: 'actions/upload-artifact', sha: '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', version: 'v7' },
  { name: 'googleapis/release-please-action', sha: '45996ed1f6d02564a971a2fa1b5860e934307cf7', version: 'v5' },
  { name: 'oven-sh/setup-bun', sha: '0c5077e51419868618aeaa5fe8019c62421857d6', version: 'v2' },
  { name: 'pnpm/action-setup', sha: 'b906affcce14559ad1aafd4ab0e942779e9f58b1', version: 'v4' },
] as const

function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

function requireText(
  source: string,
  requirements: readonly (readonly [string, string])[],
  violations: string[],
) {
  for (const [snippet, message] of requirements) {
    addViolation(!source.includes(snippet), message, violations)
  }
}
function workflowJobBlock(workflowText: string, jobName: string) {
  const marker = `  ${jobName}:\n`
  const start = workflowText.indexOf(marker)
  if (start < 0) return ''
  const remainder = workflowText.slice(start + marker.length)
  const nextJob = remainder.search(/^ {2}[a-zA-Z0-9_-]+:\s*$/m)
  return nextJob < 0 ? remainder : remainder.slice(0, nextJob)
}

function validateWorkflowActions(
  workflowPath: string,
  workflowRoot: unknown,
  violations: string[],
) {
  const approvedByName = new Map<
    string,
    (typeof APPROVED_ACTIONS)[number]
  >(APPROVED_ACTIONS.map((action) => [action.name, action]))
  for (const use of workflowActionUses(workflowRoot)) {
    if (use.ref === undefined) {
      violations.push(`${workflowPath} uses values must be strings.`)
      continue
    }
    const separator = use.ref.lastIndexOf('@')
    const name = separator < 0 ? use.ref : use.ref.slice(0, separator)
    const approved = approvedByName.get(name)
    addViolation(approved === undefined, `${workflowPath} executes unapproved action ${name}.`, violations)
    if (approved === undefined) continue
    const expectedRef = `${approved.name}@${approved.sha}`
    addViolation(use.ref !== expectedRef, `${workflowPath} must execute ${approved.name} at its approved immutable ${approved.version} SHA.`, violations)
    addViolation(use.versionComment !== approved.version, `${workflowPath} ${approved.name} uses must retain the approved # ${approved.version} comment.`, violations)
  }
}

function validateYaml(workflowPath: string, workflowText: string, violations: string[]) {
  const parsed = parsePackageReleaseWorkflow(workflowText)
  for (const error of parsed.errors) {
    violations.push(`${workflowPath} must contain valid YAML: ${error}`)
  }
  validateWorkflowActions(workflowPath, parsed.root, violations)
}

function validateCiWorkflow(ciWorkflowText: string, violations: string[]) {
  validateYaml(CI_WORKFLOW_PATH, ciWorkflowText, violations)
  const rehearsal = workflowJobBlock(ciWorkflowText, 'package-release-rehearsal')
  const artifacts = workflowJobBlock(ciWorkflowText, 'prepare-package-release')
  const gate = workflowJobBlock(ciWorkflowText, 'package-release-gate')
  requireText(ciWorkflowText, [
    ['name: Package Release Gate', `${CI_WORKFLOW_PATH} must expose the always-present Package Release Gate status.`],
    ['          - 22.19.0\n          - 24.14.0', `${CI_WORKFLOW_PATH} must rehearse exact Node 22.19.0 and 24.14.0 runtimes.`],
    ['pnpm package-release:validate', `${CI_WORKFLOW_PATH} must validate package release policy before merge.`],
    ['pnpm check', `${CI_WORKFLOW_PATH} must run full repository checks before merge.`],
    ['pnpm api:snapshot:check', `${CI_WORKFLOW_PATH} must check package API snapshots before merge.`],
    ['pnpm package-docs:check', `${CI_WORKFLOW_PATH} must check generated package documentation before merge.`],
    ['pnpm website:build', `${CI_WORKFLOW_PATH} must build versioned package documentation before merge.`],
    ['pnpm website:test', `${CI_WORKFLOW_PATH} must test the package documentation website before merge.`],
    ['pnpm docs:generate', `${CI_WORKFLOW_PATH} must generate installed agent docs before merge.`],
    ['pnpm exec playwright install chromium', `${CI_WORKFLOW_PATH} must install Chromium for browser package rehearsal.`],
    ["OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1'", `${CI_WORKFLOW_PATH} must enable browser package smoke.`],
    ["OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'", `${CI_WORKFLOW_PATH} must rehearse npm, pnpm, Yarn, and Bun consumers.`],
    [`${DIRECT_NODE} .release-tooling/scripts/package-consumer-tools.ts install`, `${CI_WORKFLOW_PATH} must install pinned consumer tools without Node module-type warnings.`],
    [`${DIRECT_NODE} .release-tooling/scripts/package-consumer-tools.ts verify`, `${CI_WORKFLOW_PATH} must verify pinned consumer tools without Node module-type warnings.`],
  ], violations)
  requireText(artifacts, [
    ["startsWith(github.head_ref, 'release-please--branches--main')", `${CI_WORKFLOW_PATH} must prepare artifacts for Release Please pull requests.`],
    ["startsWith(github.ref_name, 'release-please--branches--main')", `${CI_WORKFLOW_PATH} must prepare artifacts for exact-head Release Please dispatches.`],
    ['attestations: write', `${CI_WORKFLOW_PATH} package artifact preparation must be able to attest provenance.`],
    ['id-token: write', `${CI_WORKFLOW_PATH} package artifact preparation must use GitHub OIDC provenance.`],
    [`${DIRECT_NODE} scripts/package-release-plan.ts`, `${CI_WORKFLOW_PATH} must resolve the exact Release Please tree plan.`],
    ['pnpm exec tsx scripts/package-release-artifacts.ts prepare', `${CI_WORKFLOW_PATH} must build and verify immutable tarballs before merge.`],
    ['actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a', `${CI_WORKFLOW_PATH} must attest package tarballs and their manifest.`],
    ['subject-path: ${{ runner.temp }}/package-release-artifacts/*', `${CI_WORKFLOW_PATH} must attest every package artifact file.`],
    ['retention-days: 30', `${CI_WORKFLOW_PATH} must retain release artifacts long enough for human review.`],
  ], violations)
  requireText(gate, [
    ['- commit-policy', `${CI_WORKFLOW_PATH} Package Release Gate must depend on commit policy.`],
    ['- check', `${CI_WORKFLOW_PATH} Package Release Gate must depend on full static checks.`],
    ['- test', `${CI_WORKFLOW_PATH} Package Release Gate must depend on the test suite.`],
    ['- package-release-rehearsal', `${CI_WORKFLOW_PATH} Package Release Gate must depend on the full rehearsal.`],
    ['- prepare-package-release', `${CI_WORKFLOW_PATH} Package Release Gate must include Release Please artifacts.`],
    ['if: ${{ always() }}', `${CI_WORKFLOW_PATH} Package Release Gate must always report a conclusion.`],
    [`${DIRECT_NODE} scripts/package-release-gate.ts`, `${CI_WORKFLOW_PATH} Package Release Gate must use the typed fail-closed gate.`],
    ['github.head_ref || github.ref_name', `${CI_WORKFLOW_PATH} Package Release Gate must classify pull-request and dispatched Release Please branches.`],
  ], violations)
  addViolation(!rehearsal.includes('fail-fast: false'), `${CI_WORKFLOW_PATH} must report both Node rehearsal results.`, violations)
  addViolation((ciWorkflowText.match(/id-token: write/g)?.length ?? 0) !== 1, `${CI_WORKFLOW_PATH} must reserve id-token permission for artifact attestation.`, violations)
  addViolation(/continue-on-error:\s*true/.test(ciWorkflowText), `${CI_WORKFLOW_PATH} package release checks must not fail open.`, violations)
}

function validatePackageReleaseWorkflow(
  workflowText: string,
  promoteSource: string,
  artifactsSource: string,
  locatorSource: string,
  violations: string[],
) {
  validateYaml(WORKFLOW_PATH, workflowText, violations)
  const releasePlease = workflowJobBlock(workflowText, 'release-please')
  const releasePlan = workflowJobBlock(workflowText, 'release-plan')
  const publish = workflowJobBlock(workflowText, 'publish')
  for (const packagePath of EXPECTED_PACKAGE_PATHS) {
    addViolation(!workflowText.includes(`${packagePath}/**`), `${WORKFLOW_PATH} must trigger for ${packagePath}/**.`, violations)
  }
  requireText(releasePlease, [
    ['skip-github-release: true', `${WORKFLOW_PATH} Release Please must create version PRs without tags or GitHub Releases.`],
    ['contents: write', `${WORKFLOW_PATH} Release Please must update its coordinated PR.`],
    ['pull-requests: write', `${WORKFLOW_PATH} Release Please must update its coordinated PR.`],
  ], violations)
  requireText(workflowText, [
    [`${DIRECT_NODE} scripts/package-release-plan.ts`, `${WORKFLOW_PATH} must detect version changes through the typed tree plan.`],
    ['cancel-in-progress: false', `${WORKFLOW_PATH} must serialize and preserve in-progress package publication.`],
  ], violations)
  requireText(releasePlan, [
    ['fetch-depth: 0', `${WORKFLOW_PATH} release planning must fetch full history for multi-commit rebase merges.`],
  ], violations)
  requireText(publish, [
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
    ["'gh', ['attestation', 'verify'", 'package-release-promote.ts must verify artifact provenance.'],
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
}


export function validatePackageReleasePipelines(input: Readonly<{
  artifactsSource: string
  ciWorkflowText: string
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
    violations,
  )
}

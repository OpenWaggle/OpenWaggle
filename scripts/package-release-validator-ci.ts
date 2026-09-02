import { validateReleaseCiPolicy } from './release-ci-policy'
import {
  DIRECT_NODE,
  addViolation,
  requireText,
  validateYaml,
  workflowJobBlock,
} from './package-release-validator-shared'

const CI_WORKFLOW_PATH = '.github/workflows/ci.yml'
const REHEARSAL_BRANCH_GUARD_COUNT = 2

export function validateCiWorkflow(ciWorkflowText: string, violations: string[]) {
  validateYaml(CI_WORKFLOW_PATH, ciWorkflowText, violations)
  violations.push(...validateReleaseCiPolicy(ciWorkflowText))
  const packageRehearsal = workflowJobBlock(ciWorkflowText, 'package-release-rehearsal-package')
  const websiteRehearsal = workflowJobBlock(ciWorkflowText, 'package-release-rehearsal-website')
  const classifier = workflowJobBlock(ciWorkflowText, 'classify-package-release')
  const artifacts = workflowJobBlock(ciWorkflowText, 'prepare-package-release')
  const candidate = workflowJobBlock(ciWorkflowText, 'package-release-candidate')
  const gate = workflowJobBlock(ciWorkflowText, 'package-release-gate')
  const exactReleaseBranchGuard = "== 'release-please--branches--main'"
  if (
    ciWorkflowText.includes(
      "startsWith(github.head_ref || github.ref_name, 'release-please--branches--main')",
    ) ||
    ciWorkflowText.split(exactReleaseBranchGuard).length - 1 !==
      REHEARSAL_BRANCH_GUARD_COUNT
  ) {
    violations.push(
      `${CI_WORKFLOW_PATH} must use exact branch matching for Release Please rehearsal triggers.`,
    )
  }
  requireText(ciWorkflowText, [
    ['name: Package Release Gate', `${CI_WORKFLOW_PATH} must expose the always-present Package Release Gate status.`],
    ['node-version: 22.19.0', `${CI_WORKFLOW_PATH} must rehearse the exact Node 22.19.0 runtime for package consumers.`],
    ['node-version: 24.14.0', `${CI_WORKFLOW_PATH} must rehearse the exact Node 24.14.0 runtime for docs and website gates.`],
    ['pnpm package-release:validate', `${CI_WORKFLOW_PATH} must validate package release policy before merge.`],
    ['pnpm check', `${CI_WORKFLOW_PATH} must run full repository checks before merge.`],
    ['pnpm api:snapshot:check', `${CI_WORKFLOW_PATH} must check package API snapshots before merge.`],
    ['pnpm package-docs:check', `${CI_WORKFLOW_PATH} must check generated package documentation before merge.`],
    ['pnpm --filter @openwaggle/website build', `${CI_WORKFLOW_PATH} must build versioned package documentation before merge.`],
    ['pnpm website:test', `${CI_WORKFLOW_PATH} must test the package documentation website before merge.`],
    ['pnpm docs:generate', `${CI_WORKFLOW_PATH} must generate installed agent docs before merge.`],
    ['pnpm exec playwright install chromium', `${CI_WORKFLOW_PATH} must install Chromium for browser package rehearsal.`],
    ["OPENWAGGLE_PACKAGE_BROWSER_SMOKE: '1'", `${CI_WORKFLOW_PATH} must enable browser package smoke.`],
    ["OPENWAGGLE_PACKAGE_SMOKE_REQUIRED_MANAGERS: 'npm,pnpm,yarn,bun'", `${CI_WORKFLOW_PATH} must rehearse npm, pnpm, Yarn, and Bun consumers.`],
    [`needs.changes.outputs.package == 'true'`, `${CI_WORKFLOW_PATH} must scope package consumer rehearsal to package-changing merge results.`],
    [`needs.changes.outputs.website-docs == 'true'`, `${CI_WORKFLOW_PATH} must scope the website and docs rehearsal to website-changing merge results.`],
    [`${DIRECT_NODE} .release-tooling/scripts/package-consumer-tools.ts install`, `${CI_WORKFLOW_PATH} must install pinned consumer tools without Node module-type warnings.`],
    [`${DIRECT_NODE} .release-tooling/scripts/package-consumer-tools.ts verify`, `${CI_WORKFLOW_PATH} must verify pinned consumer tools without Node module-type warnings.`],
  ], violations)
  requireText(packageRehearsal, [
    ['name: Package Consumer Rehearsal (Node 22.19.0)', `${CI_WORKFLOW_PATH} must expose the package consumer rehearsal on the exact Node 22.19.0 runtime.`],
    ['actions/setup-node', `${CI_WORKFLOW_PATH} package consumer rehearsal must pin Node through setup-node.`],
    ['oven-sh/setup-bun', `${CI_WORKFLOW_PATH} package consumer rehearsal must install pinned Bun.`],
    ['pnpm package:smoke', `${CI_WORKFLOW_PATH} package consumer rehearsal must smoke packed tarballs.`],
  ], violations)
  requireText(websiteRehearsal, [
    ['name: Website & Docs Rehearsal (Node 24.14.0)', `${CI_WORKFLOW_PATH} must expose the website and docs rehearsal on the exact Node 24.14.0 runtime.`],
    ['pnpm website:build', `${CI_WORKFLOW_PATH} website rehearsal must build the versioned documentation site.`],
    ['pnpm website:test', `${CI_WORKFLOW_PATH} website rehearsal must test the documentation site.`],
    ['pnpm docs:generate', `${CI_WORKFLOW_PATH} website rehearsal must generate installed agent docs.`],
  ], violations)
  requireText(classifier, [
    ['name: Classify Package Release Candidate', `${CI_WORKFLOW_PATH} must classify package release candidates without privileged artifact permissions.`],
    ['prepare: ${{ steps.candidate.outputs.prepare }}', `${CI_WORKFLOW_PATH} must expose the trusted package release classification.`],
    ['Classify package release candidate', `${CI_WORKFLOW_PATH} must classify coordinated release candidates without skipping the job.`],
    ['HEAD_REF: ${{ github.head_ref }}', `${CI_WORKFLOW_PATH} must classify Release Please pull requests.`],
    ['REF_NAME: ${{ github.ref_name }}', `${CI_WORKFLOW_PATH} must classify exact-head Release Please dispatches.`],
    ['"release-please--branches--main"', `${CI_WORKFLOW_PATH} must recognize only the exact coordinated Release Please branch.`],
    ['HEAD_REPOSITORY', `${CI_WORKFLOW_PATH} must reject untrusted fork branches that imitate Release Please.`],
    ['PR_AUTHOR', `${CI_WORKFLOW_PATH} must require the GitHub Actions bot Release Please author.`],
  ], violations)
  requireText(artifacts, [
    ['name: Build and attest package artifacts (Release Please PR only)', `${CI_WORKFLOW_PATH} must clearly identify the intentionally conditional artifact job.`],
    ['needs: classify-package-release', `${CI_WORKFLOW_PATH} package artifact preparation must use the trusted classifier.`],
    ["if: needs.classify-package-release.outputs.prepare == 'true'", `${CI_WORKFLOW_PATH} must reserve artifact permissions for coordinated release candidates.`],
    ['attestations: write', `${CI_WORKFLOW_PATH} package artifact preparation must be able to attest provenance.`],
    ['id-token: write', `${CI_WORKFLOW_PATH} package artifact preparation must use GitHub OIDC provenance.`],
    [`${DIRECT_NODE} scripts/package-release-plan.ts`, `${CI_WORKFLOW_PATH} must resolve the exact Release Please tree plan.`],
    ['pnpm exec tsx scripts/package-release-artifacts.ts prepare', `${CI_WORKFLOW_PATH} must build and verify immutable tarballs before merge.`],
    ['pnpm package:smoke --tarball-dir "$RUNNER_TEMP/package-release-artifacts"', `${CI_WORKFLOW_PATH} must smoke the exact canonical tarballs before attestation.`],
    ['actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a', `${CI_WORKFLOW_PATH} must attest package tarballs and their manifest.`],
    ['subject-path: ${{ runner.temp }}/package-release-artifacts/*', `${CI_WORKFLOW_PATH} must attest every package artifact file.`],
    ['retention-days: 30', `${CI_WORKFLOW_PATH} must retain release artifacts long enough for human review.`],
  ], violations)
  requireText(candidate, [
    ['name: Package Release Candidate', `${CI_WORKFLOW_PATH} must expose the always-present candidate result.`],
    ['- classify-package-release', `${CI_WORKFLOW_PATH} Package Release Candidate must include classification.`],
    ['- prepare-package-release', `${CI_WORKFLOW_PATH} Package Release Candidate must include artifact preparation.`],
    ['if: ${{ always() }}', `${CI_WORKFLOW_PATH} Package Release Candidate must always report a conclusion.`],
    [`${DIRECT_NODE} scripts/package-release-candidate-gate.ts`, `${CI_WORKFLOW_PATH} Package Release Candidate must use the typed fail-closed candidate gate.`],
    ['github.head_ref || github.ref_name', `${CI_WORKFLOW_PATH} Package Release Candidate must classify pull-request and dispatched branches.`],
  ], violations)
  requireText(gate, [
    ['- commit-policy', `${CI_WORKFLOW_PATH} Package Release Gate must depend on commit policy.`],
    ['- check', `${CI_WORKFLOW_PATH} Package Release Gate must depend on full static checks.`],
    ['- test-unit', `${CI_WORKFLOW_PATH} Package Release Gate must depend on unit tests.`],
    ['- test-integration-component', `${CI_WORKFLOW_PATH} Package Release Gate must depend on integration and component tests.`],
    ['- test-mcp-conformance', `${CI_WORKFLOW_PATH} Package Release Gate must depend on MCP conformance.`],
    ['- electron-e2e-macos', `${CI_WORKFLOW_PATH} Package Release Gate must depend on macOS Electron E2E.`],
    ['- electron-e2e-linux', `${CI_WORKFLOW_PATH} Package Release Gate must depend on Linux Electron E2E.`],
    ['- electron-e2e-windows', `${CI_WORKFLOW_PATH} Package Release Gate must depend on Windows Electron E2E.`],
    ['- package-release-rehearsal-package', `${CI_WORKFLOW_PATH} Package Release Gate must depend on the package consumer rehearsal.`],
    ['- package-release-rehearsal-website', `${CI_WORKFLOW_PATH} Package Release Gate must depend on the website and docs rehearsal.`],
    ['- package-release-candidate', `${CI_WORKFLOW_PATH} Package Release Gate must include the candidate result.`],
    ['if: ${{ always() }}', `${CI_WORKFLOW_PATH} Package Release Gate must always report a conclusion.`],
    [`${DIRECT_NODE} scripts/package-release-gate.ts`, `${CI_WORKFLOW_PATH} Package Release Gate must use the typed fail-closed gate.`],
  ], violations)
  addViolation((ciWorkflowText.match(/id-token: write/g)?.length ?? 0) !== 1, `${CI_WORKFLOW_PATH} must reserve id-token permission for artifact attestation.`, violations)
  addViolation(/continue-on-error:\s*true/.test(ciWorkflowText), `${CI_WORKFLOW_PATH} package release checks must not fail open.`, violations)
}

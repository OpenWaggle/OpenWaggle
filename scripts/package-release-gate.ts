import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_ARGUMENT_COUNT = 10

const GATE_TIERS = ['full', 'fast', 'release-pr'] as const
export type PackageReleaseGateTier = (typeof GATE_TIERS)[number]

/**
 * Results for one CI run keyed by the gate's job keys. Values are GitHub job conclusions.
 * Jobs that did not run for the event report `skipped`.
 */
export type PackageReleaseGateResults = Readonly<
  Record<
    | 'candidateResult'
    | 'changesResult'
    | 'checkResult'
    | 'commitPolicyResult'
    | 'mcpConformanceResult'
    | 'rehearsalPackageResult'
    | 'rehearsalWebsiteResult'
    | 'testIntegrationComponentResult'
    | 'testUnitResult',
    string
  >
>

const REQUIRED_JOB_NAMES_BY_TIER: Readonly<
  Record<PackageReleaseGateTier, readonly (keyof PackageReleaseGateResults)[]>
> = {
  /*
   * The rehearsals stay conditional even in the full tier: they are path-scoped, so a
   * merge result that touches no package or website/docs surfaces legitimately skips
   * them. A rehearsal that RUNS and fails still fails the gate through the generic
   * rejected-conclusion check below.
   */
  full: [
    'commitPolicyResult',
    'checkResult',
    'changesResult',
    'testUnitResult',
    'testIntegrationComponentResult',
    'mcpConformanceResult',
    'candidateResult',
  ],
  fast: [
    'commitPolicyResult',
    'checkResult',
    'changesResult',
    'testUnitResult',
    'testIntegrationComponentResult',
    'mcpConformanceResult',
    'candidateResult',
  ],
  /*
   * The Release Please version-bump PR carries no source changes, only version and
   * changelog edits, so the app test suite (unit, integration/component, MCP) would
   * re-validate a tree already proven on the feature PRs and on the push to main, and is
   * skipped on that branch. This tier therefore does not require those jobs. `check` still
   * runs the fail-closed release policy and `candidate` still builds and attests the
   * release tarballs, both required. This tier is only selected for the authenticated
   * `release-please--branches--main` branch (classify-package-release rejects forks and
   * non-bot authors), so it cannot skip tests on an ordinary PR.
   */
  'release-pr': ['commitPolicyResult', 'checkResult', 'candidateResult'],
}

const JOB_LABELS: Readonly<Record<keyof PackageReleaseGateResults, string>> = {
  candidateResult: 'package release candidate',
  changesResult: 'changed-surface detection',
  checkResult: 'typecheck and lint',
  commitPolicyResult: 'commit policy',
  mcpConformanceResult: 'MCP conformance',
  rehearsalPackageResult: 'package consumer rehearsal',
  rehearsalWebsiteResult: 'website and docs rehearsal',
  testIntegrationComponentResult: 'integration and component tests',
  testUnitResult: 'unit tests',
}

function isGateTier(value: string): value is PackageReleaseGateTier {
  return GATE_TIERS.some((tier) => tier === value)
}

const RESULT_KEYS = [
  'commitPolicyResult',
  'checkResult',
  'changesResult',
  'testUnitResult',
  'testIntegrationComponentResult',
  'mcpConformanceResult',
  'rehearsalPackageResult',
  'rehearsalWebsiteResult',
  'candidateResult',
] as const satisfies readonly (keyof PackageReleaseGateResults)[]

/**
 * Enforces one tier of CI readiness. Required jobs must conclude with `success`; every
 * other job must conclude with `success` or `skipped` — a conditional job that does not
 * apply to the event is legitimate, while a failed or cancelled job never is.
 */
export function validatePackageReleaseGate(input: Readonly<{ results: PackageReleaseGateResults; tier: string }>) {
  if (!isGateTier(input.tier)) {
    throw new Error(`Unknown package release gate tier: ${JSON.stringify(input.tier)}.`)
  }
  const requiredJobs = REQUIRED_JOB_NAMES_BY_TIER[input.tier]
  for (const jobKey of RESULT_KEYS) {
    const result = input.results[jobKey]
    if (result === 'success') {
      continue
    }
    if (result === 'skipped' && !requiredJobs.includes(jobKey)) {
      continue
    }
    if (result === 'skipped') {
      throw new Error(
        `${JOB_LABELS[jobKey]} is required for the ${input.tier} tier but was skipped.`,
      )
    }
    throw new Error(`${JOB_LABELS[jobKey]} did not succeed: ${result}.`)
  }
}

function readGateResults(args: readonly (string | undefined)[]): PackageReleaseGateResults {
  const [
    commitPolicyResult,
    checkResult,
    changesResult,
    testUnitResult,
    testIntegrationComponentResult,
    mcpConformanceResult,
    rehearsalPackageResult,
    rehearsalWebsiteResult,
    candidateResult,
  ] = args
  return {
    candidateResult: candidateResult ?? '',
    changesResult: changesResult ?? '',
    checkResult: checkResult ?? '',
    commitPolicyResult: commitPolicyResult ?? '',
    mcpConformanceResult: mcpConformanceResult ?? '',
    rehearsalPackageResult: rehearsalPackageResult ?? '',
    rehearsalWebsiteResult: rehearsalWebsiteResult ?? '',
    testIntegrationComponentResult: testIntegrationComponentResult ?? '',
    testUnitResult: testUnitResult ?? '',
  }
}

export function runPackageReleaseGateCli(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error(
      'Usage: package-release-gate.ts <tier> <commit-policy-result> <check-result> <changes-result> <test-unit-result> <test-integration-component-result> <test-mcp-conformance-result> <rehearsal-package-result> <rehearsal-website-result> <candidate-result>.',
    )
  }
  const [tier, ...resultArgs] = args
  if (tier === undefined || resultArgs.length !== EXPECTED_ARGUMENT_COUNT - 1) {
    throw new Error('Package release gate arguments are incomplete.')
  }
  validatePackageReleaseGate({ results: readGateResults(resultArgs), tier })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPackageReleaseGateCli(process.argv.slice(CLI_ARGUMENT_START_INDEX))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

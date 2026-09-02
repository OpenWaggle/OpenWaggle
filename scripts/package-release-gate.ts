import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_ARGUMENT_COUNT = 13

const GATE_TIERS = ['full', 'fast', 'fast-no-e2e', 'visual'] as const
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
    | 'e2eLinuxResult'
    | 'e2eMacosResult'
    | 'e2eWindowsResult'
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
    'e2eMacosResult',
    'e2eLinuxResult',
    'e2eWindowsResult',
    'candidateResult',
  ],
  fast: [
    'commitPolicyResult',
    'checkResult',
    'changesResult',
    'testUnitResult',
    'testIntegrationComponentResult',
    'mcpConformanceResult',
    'e2eMacosResult',
    'candidateResult',
  ],
  'fast-no-e2e': [
    'commitPolicyResult',
    'checkResult',
    'testUnitResult',
    'testIntegrationComponentResult',
    'mcpConformanceResult',
    'candidateResult',
  ],
  visual: ['e2eMacosResult'],
}

const JOB_LABELS: Readonly<Record<keyof PackageReleaseGateResults, string>> = {
  candidateResult: 'package release candidate',
  changesResult: 'changed-surface detection',
  checkResult: 'typecheck and lint',
  commitPolicyResult: 'commit policy',
  e2eLinuxResult: 'Electron E2E (Linux)',
  e2eMacosResult: 'Electron E2E (macOS)',
  e2eWindowsResult: 'Electron E2E (Windows)',
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
  'e2eMacosResult',
  'e2eLinuxResult',
  'e2eWindowsResult',
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
    e2eMacosResult,
    e2eLinuxResult,
    e2eWindowsResult,
    rehearsalPackageResult,
    rehearsalWebsiteResult,
    candidateResult,
  ] = args
  return {
    candidateResult: candidateResult ?? '',
    changesResult: changesResult ?? '',
    checkResult: checkResult ?? '',
    commitPolicyResult: commitPolicyResult ?? '',
    e2eLinuxResult: e2eLinuxResult ?? '',
    e2eMacosResult: e2eMacosResult ?? '',
    e2eWindowsResult: e2eWindowsResult ?? '',
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
      'Usage: package-release-gate.ts <tier> <commit-policy-result> <check-result> <changes-result> <test-unit-result> <test-integration-component-result> <test-mcp-conformance-result> <e2e-macos-result> <e2e-linux-result> <e2e-windows-result> <rehearsal-package-result> <rehearsal-website-result> <candidate-result>.',
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

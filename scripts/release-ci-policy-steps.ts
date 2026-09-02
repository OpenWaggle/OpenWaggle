/**
 * The exact CI step literals the release policy pins.
 *
 * Extracted from `release-ci-policy.ts` so that file stays within the 300-line cap. These
 * are deliberately literal: the policy compares them byte-for-byte against
 * `.github/workflows/ci.yml`, so a step cannot be added, reordered or weakened without an
 * explicit, reviewed change here.
 *
 * Note the comparison slices each step from one `      - ` marker to the next, so a comment
 * placed between two steps becomes part of the preceding step's text and will fail the
 * match. Keep rationale in this file rather than interleaved in the workflow.
 */
const ACTION_CHECKOUT = 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6'
const ACTION_SETUP_NODE = 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6'
const PNPM_ACTION_SETUP = 'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4'
const ACTION_UPLOAD_ARTIFACT =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7'
export const IMMUTABLE_ACTIONS = [ACTION_CHECKOUT, PNPM_ACTION_SETUP, ACTION_SETUP_NODE] as const
export const REQUIRED_JOB_RUNNERS = new Map<string, string>([
  ['Electron E2E (macOS)', 'macos-15'],
  ['Electron E2E (Linux)', 'ubuntu-latest'],
  ['Electron E2E (Windows)', 'windows-latest'],
])
export const REQUIRED_COMMANDS = new Map<string, string>([
  ['Typecheck & Lint', 'pnpm check'],
  ['Unit Tests', 'pnpm test:unit'],
  [
    'Integration & Component Tests',
    'pnpm test:integration && pnpm test:component',
  ],
  ['MCP Conformance', 'pnpm prepare:native:node && pnpm test:mcp:conformance'],
  ['Electron E2E (macOS)', 'pnpm test:e2e'],
  ['Electron E2E (Linux)', 'xvfb-run --auto-servernum pnpm test:e2e:functional'],
  ['Electron E2E (Windows)', 'pnpm test:e2e:functional'],
])
export const CONCURRENCY_GROUP =
  'group: ci-${{ github.event_name }}-${{ github.event.pull_request.number || inputs.head_sha || github.ref }}'
export const CONCURRENCY_CANCEL_LINE =
  'cancel-in-progress: ${{ github.event_name != \'merge_group\' }}'
/*
 * Byte-exact job-level conditions for the queue-only jobs. These jobs are skipped on
 * ordinary pull-request pushes by design (ADR 0025): the merge queue and dispatched full
 * runs are their enforcement points, so the condition text is part of the contract.
 */
export const QUEUE_ONLY_JOB_CONDITIONS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'Electron E2E (macOS)',
    ["    if: github.event_name != 'push'\n"],
  ],
  [
    'Electron E2E (Linux)',
    [
      "    if: github.event_name == 'merge_group' || (github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'full')\n",
    ],
  ],
  [
    'Electron E2E (Windows)',
    [
      "    if: github.event_name == 'merge_group' || (github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'full')\n",
    ],
  ],
  [
    'Package Consumer Rehearsal (Node 22.19.0)',
    [
      "    if: >-\n",
      "      (github.event_name == 'merge_group' || (github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'full')) &&\n",
      "      (needs.changes.outputs.package == 'true' || (github.head_ref || github.ref_name) == 'release-please--branches--main')\n",
    ],
  ],
  [
    'Website & Docs Rehearsal (Node 24.14.0)',
    [
      "    if: >-\n",
      "      (github.event_name == 'merge_group' || (github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'full')) &&\n",
      "      (needs.changes.outputs.website-docs == 'true' || (github.head_ref || github.ref_name) == 'release-please--branches--main')\n",
    ],
  ],
])
export const DISPATCH_GUARD_STEP = `      - name: Verify dispatched commit identity
        if: github.event_name == 'workflow_dispatch'
        env:
          DISPATCHED_SHA: \${{ github.sha }}
          EXPECTED_SHA: \${{ inputs.head_sha }}
        run: |
          [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
          test "$DISPATCHED_SHA" = "$EXPECTED_SHA"`
export const WINDOWS_DISPATCH_GUARD_STEP = `      - name: Verify dispatched commit identity
        if: github.event_name == 'workflow_dispatch'
        env:
          DISPATCHED_SHA: \${{ github.sha }}
          EXPECTED_SHA: \${{ inputs.head_sha }}
        run: |
          if ($env:EXPECTED_SHA -notmatch '^[0-9a-f]{40}$') { exit 1 }
          if ($env:DISPATCHED_SHA -ne $env:EXPECTED_SHA) { exit 1 }`
export const CHECKOUT_STEP = `      - uses: ${ACTION_CHECKOUT}
        with:
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}`
export const COMMIT_POLICY_CHECKOUT_STEP = `      - uses: ${ACTION_CHECKOUT}
        with:
          fetch-depth: 0
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}`
const PNPM_SETUP_STEP = `      - uses: ${PNPM_ACTION_SETUP}
        with:
          version: 11.15.1`
const NODE_SETUP_STEP = `      - uses: ${ACTION_SETUP_NODE}
        with:
          node-version: 24.14.0
          cache: pnpm`
/*
 * Install runs through the repo-owned composite action, which retries transient
 * registry/postinstall network failures (for example onnxruntime binary downloads)
 * instead of red a whole run on one timeout.
 */
const INSTALL_COMPOSITE_STEP = '      - uses: ./.github/actions/pnpm-install'
/*
 * Syntax performance budgets from #180, calibrated for the hosted macOS runner. Kept in
 * the macOS E2E job so a renderer syntax regression surfaces per push in the Fast gate.
 */
const SYNTAX_BENCHMARK_STEP = `      - run: pnpm benchmark:syntax
        env:
          SYNTAX_BENCHMARK_PROFILE: performance/syntax-budgets/macos-arm64-github-hosted.json`
const e2eFailureArtifactStep = (platform: 'linux' | 'macos' | 'windows') =>
  `      - name: Upload Electron E2E failure artifacts
        if: failure()
        uses: ${ACTION_UPLOAD_ARTIFACT}
        with:
          name: electron-e2e-${platform}-failure
          path: test-results
          if-no-files-found: ignore
          retention-days: 7`
const e2eReportArtifactStep = (platform: 'linux' | 'macos' | 'windows') =>
  `      - name: Upload Electron E2E Playwright report
        if: failure()
        uses: ${ACTION_UPLOAD_ARTIFACT}
        with:
          name: electron-e2e-${platform}-report
          path: playwright-report
          if-no-files-found: ignore
          retention-days: 7`
const LINUX_ELECTRON_DEPENDENCIES_STEP = `      - name: Install Linux Electron dependencies
        run: pnpm exec playwright install-deps chromium`
/*
 * NSIS is required by `pnpm check:installer`, which compile-checks build/installer.nsh.
 * Pinned here because a broken installer script otherwise only surfaces when the release
 * workflow packages Windows - it silently broke two consecutive releases before this
 * check existed.
 */
const NSIS_INSTALL_STEP = `      - name: Install NSIS for the installer script check
        run: sudo apt-get update && sudo apt-get install -y nsis`
const RELEASE_POLICY_STEP = '      - run: pnpm exec tsx scripts/release-ci-policy.ts'
const CONVENTIONAL_COMMITS_STEP = `      - name: Validate Conventional Commits
        env:
          COMMIT_POLICY_FROM: \${{ github.event_name == 'push' && github.event.before || github.event_name == 'pull_request' && github.event.pull_request.base.sha || '' }}
          COMMIT_POLICY_TO: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
          PR_TITLE: \${{ github.event_name == 'pull_request' && github.event.pull_request.title || '' }}
        run: pnpm exec tsx scripts/check-conventional-commits.ts --from "$COMMIT_POLICY_FROM" --to "$COMMIT_POLICY_TO" --pr-title "$PR_TITLE"`
const MACOS_FULL_E2E_STEP = `      - name: Run Electron E2E (full suite including visual baselines)
        if: github.event_name != 'workflow_dispatch' || inputs.ci_tier != 'visual'
        run: pnpm test:e2e`
const MACOS_VISUAL_E2E_STEP = `      - name: Run Electron E2E (visual baselines only)
        if: github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'visual'
        run: pnpm test:e2e:visual`

export const EXPECTED_STEPS = new Map<string, readonly string[]>([
  [
    'Commit Policy',
    [
      DISPATCH_GUARD_STEP,
      COMMIT_POLICY_CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      RELEASE_POLICY_STEP,
      CONVENTIONAL_COMMITS_STEP,
    ],
  ],
  [
    'Typecheck & Lint',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      NSIS_INSTALL_STEP,
      '      - run: pnpm check',
    ],
  ],
  [
    'Unit Tests',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      '      - run: pnpm test:unit',
    ],
  ],
  [
    'Integration & Component Tests',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      '      - run: pnpm test:integration && pnpm test:component',
    ],
  ],
  [
    'MCP Conformance',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      '      - run: pnpm prepare:native:node && pnpm test:mcp:conformance',
    ],
  ],
  [
    'Electron E2E (macOS)',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      SYNTAX_BENCHMARK_STEP,
      MACOS_FULL_E2E_STEP,
      MACOS_VISUAL_E2E_STEP,
      e2eFailureArtifactStep('macos'),
      e2eReportArtifactStep('macos'),
    ],
  ],
  [
    'Electron E2E (Linux)',
    [
      DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      LINUX_ELECTRON_DEPENDENCIES_STEP,
      '      - run: xvfb-run --auto-servernum pnpm test:e2e:functional',
      e2eFailureArtifactStep('linux'),
      e2eReportArtifactStep('linux'),
    ],
  ],
  [
    'Electron E2E (Windows)',
    [
      WINDOWS_DISPATCH_GUARD_STEP,
      CHECKOUT_STEP,
      PNPM_SETUP_STEP,
      NODE_SETUP_STEP,
      INSTALL_COMPOSITE_STEP,
      '      - run: pnpm test:e2e:functional',
      e2eFailureArtifactStep('windows'),
      e2eReportArtifactStep('windows'),
    ],
  ],
])

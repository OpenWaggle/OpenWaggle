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
export const IMMUTABLE_ACTIONS = [ACTION_CHECKOUT, PNPM_ACTION_SETUP, ACTION_SETUP_NODE] as const
export const REQUIRED_COMMANDS = new Map<string, string>([
  ['Typecheck & Lint', 'pnpm check'],
  ['Unit Tests', 'pnpm test:unit'],
  [
    'Integration & Component Tests',
    'pnpm test:integration && pnpm test:component',
  ],
  ['MCP Conformance', 'pnpm prepare:native:node && pnpm test:mcp:conformance'],
])
export const CONCURRENCY_GROUP =
  'group: ci-${{ github.event_name }}-${{ github.event.pull_request.number || inputs.head_sha || github.ref }}'
export const CONCURRENCY_CANCEL_LINE =
  'cancel-in-progress: ${{ github.event_name != \'merge_group\' }}'
// Jobs permitted an exact job-level `if`. The three app-test jobs carry only the Release
// Please skip (source is unchanged on that authenticated version-bump branch, so re-running
// is redundant); the two rehearsals are dispatch-gated and path-scoped. Asserted exactly, so
// no job here can carry an arbitrary skip.
const RELEASE_PR_SKIP = "    if: ${{ !(github.event_name == 'pull_request' && github.head_ref == 'release-please--branches--main' && github.event.pull_request.head.repo.full_name == github.repository) }}\n"
export const ALLOWED_JOB_CONDITIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['Unit Tests', [RELEASE_PR_SKIP]],
  ['Integration & Component Tests', [RELEASE_PR_SKIP]],
  ['MCP Conformance', [RELEASE_PR_SKIP]],
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
const TERMINAL_SHELLS_INSTALL_STEP = `      - name: Install terminal integration shells
        run: |
          sudo apt-get update
          sudo apt-get install --yes zsh
          /bin/zsh --version
          while IFS= read -r insecure_path; do
            [ -n "$insecure_path" ] || continue
            sudo chown root -- "$insecure_path"
            sudo chmod go-w -- "$insecure_path"
          done < <(/bin/zsh -f -c 'autoload -Uz compaudit; compaudit')
          /bin/zsh -f -c 'autoload -Uz compaudit; compaudit'`
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
          COMMIT_POLICY_EVENT: \${{ github.event_name }}
          PR_TITLE: \${{ github.event_name == 'pull_request' && github.event.pull_request.title || '' }}
        run: |
          if [ "$COMMIT_POLICY_EVENT" = workflow_dispatch ]; then
            git fetch --no-tags origin main:refs/remotes/origin/main
            COMMIT_POLICY_FROM="$(git merge-base "$COMMIT_POLICY_TO" refs/remotes/origin/main)"
            test -n "$COMMIT_POLICY_FROM"
            git merge-base --is-ancestor "$COMMIT_POLICY_FROM" "$COMMIT_POLICY_TO"
            git merge-base --is-ancestor "$COMMIT_POLICY_FROM" refs/remotes/origin/main
          fi
          pnpm exec tsx scripts/check-conventional-commits.ts --from "$COMMIT_POLICY_FROM" --to "$COMMIT_POLICY_TO" --pr-title "$PR_TITLE"`

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
      TERMINAL_SHELLS_INSTALL_STEP,
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
])

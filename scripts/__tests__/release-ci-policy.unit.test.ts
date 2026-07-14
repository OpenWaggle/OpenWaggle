import { describe, expect, it } from 'vitest'
import { validateReleaseCiPolicy } from '../release-ci-policy'

const ACTION_CHECKOUT = 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6'
const ACTION_SETUP_NODE = 'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6'
const PNPM_ACTION_SETUP = 'pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4'

const dispatchIdentityGuard = `      - name: Verify dispatched commit identity
        if: github.event_name == 'workflow_dispatch'
        env:
          DISPATCHED_SHA: \${{ github.sha }}
          EXPECTED_SHA: \${{ inputs.head_sha }}
        run: |
          [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]
          test "$DISPATCHED_SHA" = "$EXPECTED_SHA"
`

const compliantWorkflow = `
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      head_sha:
        description: Exact release PR head SHA to validate.
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.event.pull_request.number || inputs.head_sha || github.ref }}
  cancel-in-progress: true
jobs:
  commit-policy:
    name: Commit Policy
    steps:
${dispatchIdentityGuard}      - uses: ${ACTION_CHECKOUT}
        with:
          fetch-depth: 0
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}
      - uses: ${PNPM_ACTION_SETUP}
      - uses: ${ACTION_SETUP_NODE}
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsx scripts/release-ci-policy.ts
      - name: Validate Conventional Commits
        env:
          COMMIT_POLICY_FROM: \${{ github.event_name == 'push' && github.event.before || github.event_name == 'pull_request' && github.event.pull_request.base.sha || '' }}
          COMMIT_POLICY_TO: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}
          PR_TITLE: \${{ github.event_name == 'pull_request' && github.event.pull_request.title || '' }}
        run: pnpm exec tsx scripts/check-conventional-commits.ts --from "$COMMIT_POLICY_FROM" --to "$COMMIT_POLICY_TO" --pr-title "$PR_TITLE"
  check:
    name: Typecheck & Lint
    steps:
${dispatchIdentityGuard}      - uses: ${ACTION_CHECKOUT}
        with:
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}
      - uses: ${PNPM_ACTION_SETUP}
      - uses: ${ACTION_SETUP_NODE}
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
  test:
    name: Unit & Component Tests
    steps:
${dispatchIdentityGuard}      - uses: ${ACTION_CHECKOUT}
        with:
          ref: \${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}
      - uses: ${PNPM_ACTION_SETUP}
      - uses: ${ACTION_SETUP_NODE}
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
`

describe('release CI policy', () => {
  it('accepts CI that validates commits and runs the required checks for dispatched SHAs', () => {
    expect(validateReleaseCiPolicy(compliantWorkflow)).toEqual([])
  })

  it('rejects a workflow that skips release commits or omits dispatched-ref checkout', () => {
    const violations = validateReleaseCiPolicy(
      compliantWorkflow
        .replaceAll(
          "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.head_sha || github.sha }}\n",
          '',
        )
        .replace('name: Typecheck & Lint', "if: \"!startsWith(github.event.head_commit.message, 'chore(release):')\"\n    name: Typecheck & Lint"),
    )

    expect(violations).toEqual(
      expect.arrayContaining([
        'CI must check out inputs.head_sha for workflow_dispatch validation.',
        'CI must not skip release commits; release commits require the same checks.',
      ]),
    )
  })

  it('rejects a workflow_dispatch path without an immutable SHA identity guard', () => {
    const violations = validateReleaseCiPolicy(compliantWorkflow.replace(dispatchIdentityGuard, ''))

    expect(violations).toContain(
      'CI workflow_dispatch must verify github.sha matches the immutable inputs.head_sha SHA.',
    )
  })

  it('rejects job names beyond the three stable required checks', () => {
    const workflowWithExtraJob = `${compliantWorkflow}
  optional-smoke:
    name: Optional Smoke
    steps:
      - run: pnpm test
`

    expect(validateReleaseCiPolicy(workflowWithExtraJob)).toContain(
      'CI must expose exactly these required job names: Commit Policy, Typecheck & Lint, Unit & Component Tests.',
    )
  })

  it('rejects excess token privilege and stale action majors', () => {
    const weakenedWorkflow = compliantWorkflow
      .replace('permissions:\n  contents: read\n', '')
      .replaceAll(ACTION_CHECKOUT, 'actions/checkout@v6')
      .replaceAll(PNPM_ACTION_SETUP, 'pnpm/action-setup@v4')
      .replaceAll(ACTION_SETUP_NODE, 'actions/setup-node@v6')

    expect(validateReleaseCiPolicy(weakenedWorkflow)).toEqual(
      expect.arrayContaining([
        'CI must grant only read access to repository contents.',
        `CI must use ${ACTION_CHECKOUT} in every required job.`,
        `CI must use ${PNPM_ACTION_SETUP} in every required job.`,
        `CI must use ${ACTION_SETUP_NODE} in every required job.`,
      ]),
    )
  })

  it('rejects dispatch inputs that are not validated as canonical commit SHAs', () => {
    const workflowWithoutShaFormatGuard = compliantWorkflow.replace(
      '          [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]\n',
      '',
    )

    expect(validateReleaseCiPolicy(workflowWithoutShaFormatGuard)).toContain(
      'CI workflow_dispatch must validate inputs.head_sha as a canonical commit SHA in every required job.',
    )
  })

  it('rejects conditions that can skip a required job for regular pull requests', () => {
    const conditionallySkippedWorkflow = compliantWorkflow.replace(
      '  check:\n    name: Typecheck & Lint',
      "  check:\n    if: github.event_name == 'workflow_dispatch'\n    name: Typecheck & Lint",
    )

    expect(validateReleaseCiPolicy(conditionallySkippedWorkflow)).toContain(
      'CI required jobs must run unconditionally for every configured trigger.',
    )
  })

  it('rejects concurrency that groups exact-SHA dispatches by a mutable branch ref', () => {
    const branchRacyWorkflow = compliantWorkflow.replace(
      'github.event.pull_request.number || inputs.head_sha || github.ref',
      'github.event.pull_request.number || github.ref',
    )

    expect(validateReleaseCiPolicy(branchRacyWorkflow)).toContain(
      'CI concurrency must isolate workflow_dispatch runs by inputs.head_sha and cancel stale duplicate work.',
    )
  })

  it('rejects action setup moved out of one required job into another', () => {
    const redistributedActionsWorkflow = compliantWorkflow
      .replace(ACTION_CHECKOUT, 'actions/checkout@v6')
      .replace('      - run: pnpm test', `      - uses: ${ACTION_CHECKOUT}\n      - run: pnpm test`)

    expect(validateReleaseCiPolicy(redistributedActionsWorkflow)).toContain(
      `CI job Commit Policy must use ${ACTION_CHECKOUT} exactly once.`,
    )
  })

  it('rejects a dispatch identity guard moved out of one required job into another', () => {
    const redistributedGuardWorkflow = compliantWorkflow
      .replace(dispatchIdentityGuard, '')
      .replace('      - run: pnpm test', `${dispatchIdentityGuard}      - run: pnpm test`)

    expect(validateReleaseCiPolicy(redistributedGuardWorkflow)).toContain(
      'CI job Commit Policy must independently guard and check out inputs.head_sha.',
    )
  })

  it('rejects a required command moved into a differently named job', () => {
    const redistributedCommandWorkflow = compliantWorkflow
      .replace('      - run: pnpm check', '      - run: echo skipped')
      .replace('      - run: pnpm test', '      - run: pnpm check\n      - run: pnpm test')

    expect(validateReleaseCiPolicy(redistributedCommandWorkflow)).toContain(
      'CI job Typecheck & Lint must run pnpm check as an exact, fail-closed step.',
    )
  })

  it.each([
    ['shell fallback', '      - run: pnpm check || true'],
    ['comment-only match', '      # run: pnpm check'],
    ['continued execution', '      - run: |\n          pnpm check\n          echo ignored'],
  ])('rejects %s instead of the exact required command', (_name, replacement) => {
    const weakenedWorkflow = compliantWorkflow.replace('      - run: pnpm check', replacement)

    expect(validateReleaseCiPolicy(weakenedWorkflow)).toContain(
      'CI job Typecheck & Lint must run pnpm check as an exact, fail-closed step.',
    )
  })

  it('rejects continue-on-error on a required step', () => {
    const weakenedWorkflow = compliantWorkflow.replace(
      '      - run: pnpm test',
      '      - run: pnpm test\n        continue-on-error: true',
    )

    expect(validateReleaseCiPolicy(weakenedWorkflow)).toContain(
      'CI required steps must not use continue-on-error.',
    )
  })

  it('rejects a no-op dispatch SHA guard even when the expected text remains in a comment', () => {
    const weakenedWorkflow = compliantWorkflow.replace(
      '          test "$DISPATCHED_SHA" = "$EXPECTED_SHA"',
      '          # test "$DISPATCHED_SHA" = "$EXPECTED_SHA"\n          true',
    )

    expect(validateReleaseCiPolicy(weakenedWorkflow)).toContain(
      'CI job Commit Policy must independently guard and check out inputs.head_sha.',
    )
  })

  it('does not accept commented trigger or concurrency text as active policy', () => {
    const weakenedWorkflow = compliantWorkflow
      .replace('  pull_request:\n    branches: [main]', '  # pull_request:\n    # branches: [main]')
      .replace(
        '  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || inputs.head_sha || github.ref }}',
        '  # group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || inputs.head_sha || github.ref }}',
      )

    expect(validateReleaseCiPolicy(weakenedWorkflow)).toEqual(
      expect.arrayContaining([
        'CI must run on pull requests targeting main.',
        'CI concurrency must isolate workflow_dispatch runs by inputs.head_sha and cancel stale duplicate work.',
      ]),
    )
  })

  it('rejects workflow shell defaults that could change fail-closed command semantics', () => {
    const weakenedWorkflow = compliantWorkflow.replace(
      'jobs:\n',
      "defaults:\n  run:\n    shell: bash -c '{0} || true'\njobs:\n",
    )

    expect(validateReleaseCiPolicy(weakenedWorkflow)).toContain(
      'CI must not override the default shell for required steps.',
    )
  })
})

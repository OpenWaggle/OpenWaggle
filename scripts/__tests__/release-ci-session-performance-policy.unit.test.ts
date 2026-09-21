import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import { validateReleaseCiPolicy } from '../release-ci-policy'
import { validCiWorkflow, validWorkflow, writeMinimalPackageReleaseProject } from './package-release-validator.fixtures'

const PERFORMANCE_PATH = '.github/workflows/session-performance.yml'
const PERFORMANCE_WORKFLOW = readFileSync(PERFORMANCE_PATH, 'utf8')
const MANUAL_FULL = "github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'full'"
const CALLER_BLOCK = `  session-performance:
    name: Session Performance
    if: ${MANUAL_FULL}
    uses: ./.github/workflows/session-performance.yml
    with:
      head_sha: \${{ inputs.head_sha }}
    permissions:
      contents: read`
const RESULT_STEP = `      - name: Require selected Session Performance result
        if: ${MANUAL_FULL}
        env:
          SESSION_PERFORMANCE_RESULT: \${{ needs.session-performance.result }}
        run: test "$SESSION_PERFORMANCE_RESULT" = success`

function mutate(source: string, target: string, replacement: string) {
  expect(source).toContain(target)
  const result = source.replace(target, replacement)
  expect(result).not.toBe(source)
  return result
}

describe('reusable Session Performance release policy', () => {
  it('accepts the reviewed exact-commit caller and blocking manual-full gate', () => {
    expect(validateReleaseCiPolicy(validCiWorkflow)).toEqual([])
  })

  it.each([
    ['mutable callee reference', 'uses: ./.github/workflows/session-performance.yml', 'uses: OpenWaggle/OpenWaggle/.github/workflows/session-performance.yml@main'],
    ['different local workflow', 'uses: ./.github/workflows/session-performance.yml', 'uses: ./.github/workflows/attacker.yml'],
    ['caller SHA substitution', 'head_sha: ${{ inputs.head_sha }}', 'head_sha: ${{ github.sha }}'],
    ['caller branch substitution', 'head_sha: ${{ inputs.head_sha }}', 'head_sha: ${{ github.ref }}'],
    ['caller skip', `if: ${MANUAL_FULL}`, 'if: false'],
    ['caller scope widening', `if: ${MANUAL_FULL}`, 'if: true'],
    ['caller privilege', 'contents: read', 'contents: write'],
    ['caller inherited secrets', '    permissions:', '    secrets: inherit\n    permissions:'],
    ['caller ignored failure', '    permissions:', '    continue-on-error: true\n    permissions:'],
  ])('rejects %s', (_name, target, replacement) => {
    const caller = mutate(CALLER_BLOCK, target, replacement)
    const workflow = mutate(validCiWorkflow, CALLER_BLOCK, caller)
    expect(validateReleaseCiPolicy(workflow)).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it('rejects removing the performance dependency from the always-present gate', () => {
    const workflow = mutate(validCiWorkflow, '      - session-performance\n', '')
    expect(validateReleaseCiPolicy(workflow)).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it.each([
    ['gate step removal', RESULT_STEP, ''],
    ['gate step skip', `if: ${MANUAL_FULL}`, 'if: false'],
    ['gate result substitution', '${{ needs.session-performance.result }}', 'success'],
    ['gate failure suppression', 'run: test "$SESSION_PERFORMANCE_RESULT" = success', 'run: test "$SESSION_PERFORMANCE_RESULT" = success || true'],
    ['gate ignored failure', '        env:', '        continue-on-error: true\n        env:'],
  ])('rejects %s', (_name, target, replacement) => {
    const step = mutate(RESULT_STEP, target, replacement)
    const workflow = mutate(validCiWorkflow, RESULT_STEP, step)
    expect(validateReleaseCiPolicy(workflow)).toContain(
      'CI workflow must match its exact fail-closed AST contract.',
    )
  })

  it.each([
    ['callee guard removal', '          test "$DISPATCHED_SHA" = "$EXPECTED_SHA"', '          true'],
    ['callee SHA format guard removal', '          [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]', '          true'],
    ['callee skipped guard', '      - name: Verify benchmark commit identity', '      - name: Verify benchmark commit identity\n        if: false'],
    ['callee guard input substitution', 'EXPECTED_SHA: ${{ inputs.head_sha }}', 'EXPECTED_SHA: ${{ github.sha }}'],
    ['callee checkout substitution', 'ref: ${{ inputs.head_sha || github.sha }}', 'ref: main'],
    ['callee privilege escalation', 'contents: read', 'contents: write'],
    ['callee job skip', '    name: Session Performance', '    name: Session Performance\n    if: false'],
    ['callee benchmark suppression', 'run: pnpm benchmark:session-release', 'run: pnpm benchmark:session-release || true'],
    ['callee smaller corpus', 'run: pnpm benchmark:session-release', 'run: pnpm benchmark:session-performance'],
  ])('rejects %s through the production file validator', async (_name, target, replacement) => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-performance-policy-'))
    try {
      await writeMinimalPackageReleaseProject(projectRoot, validWorkflow)
      await fs.writeFile(path.join(projectRoot, PERFORMANCE_PATH), mutate(PERFORMANCE_WORKFLOW, target, replacement))
      const { violations } = await validatePackageReleaseFiles(projectRoot)
      expect(violations).toContain(
        'Session Performance workflow must match its exact fail-closed AST contract.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})

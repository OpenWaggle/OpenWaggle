import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const PROJECT_ROOT = process.cwd()
const PACKAGE_JSON = fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')
const WORKFLOW = fs.readFileSync(
  path.join(PROJECT_ROOT, '.github/workflows/session-performance.yml'),
  'utf8',
)
const CI_WORKFLOW = fs.readFileSync(path.join(PROJECT_ROOT, '.github/workflows/ci.yml'), 'utf8')
const MANUAL_FULL = "github.event_name == 'workflow_dispatch' && inputs.ci_tier == 'full'"

describe('Session Performance workflow', () => {
  it('enforces the ten-million-message release corpus', () => {
    expect(WORKFLOW).toContain('pnpm benchmark:session-release')
    expect(WORKFLOW).not.toContain('pnpm benchmark:session-performance')
    expect(PACKAGE_JSON).toContain(
      '"benchmark:session-release": "pnpm benchmark:session-embedding && pnpm benchmark:session-vector-index && pnpm benchmark:session-database"',
    )
  })

  it('remains standalone and accepts an exact-commit reusable invocation', () => {
    expect(parse(WORKFLOW)).toMatchObject({
      on: {
        merge_group: null,
        workflow_dispatch: { inputs: { head_sha: { required: true, type: 'string' } } },
        workflow_call: { inputs: { head_sha: { required: true, type: 'string' } } },
      },
      permissions: { contents: 'read' },
      jobs: {
        'session-performance': {
          'runs-on': 'ubuntu-latest',
          'timeout-minutes': 45,
          steps: expect.arrayContaining([
            expect.objectContaining({
              name: 'Verify benchmark commit identity',
              env: {
                DISPATCHED_SHA: '${{ github.sha }}',
                EXPECTED_SHA: '${{ inputs.head_sha }}',
                EVENT_NAME: '${{ github.event_name }}',
              },
              run: expect.stringContaining('test "$DISPATCHED_SHA" = "$EXPECTED_SHA"'),
            }),
            expect.objectContaining({ with: { ref: '${{ inputs.head_sha || github.sha }}' } }),
          ]),
        },
      },
    })
  })

  it('calls the same-commit benchmark only from the registered CI manual full tier', () => {
    expect(parse(CI_WORKFLOW)).toMatchObject({
      jobs: {
        'session-performance': {
          if: MANUAL_FULL,
          uses: './.github/workflows/session-performance.yml',
          with: { head_sha: '${{ inputs.head_sha }}' },
          permissions: { contents: 'read' },
        },
      },
    })
  })

  it('makes the always-present Full gate reject a selected failed or skipped benchmark', () => {
    expect(parse(CI_WORKFLOW)).toMatchObject({
      jobs: {
        'package-release-gate': {
          if: '${{ always() }}',
          needs: expect.arrayContaining(['session-performance']),
          steps: expect.arrayContaining([
            {
              name: 'Require selected Session Performance result',
              if: MANUAL_FULL,
              env: { SESSION_PERFORMANCE_RESULT: '${{ needs.session-performance.result }}' },
              run: 'test "$SESSION_PERFORMANCE_RESULT" = success',
            },
          ]),
        },
      },
    })
  })
})

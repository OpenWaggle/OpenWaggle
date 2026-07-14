import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

describe('package release recovery workflow validation', () => {
  it('rejects recovery jobs that can be skipped by the Release Please ancestor', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          "if: ${{ always() && needs.release-plan.result == 'success' }}",
          "if: ${{ needs.release-plan.result == 'success' }}\n    env:\n      ALWAYS_DECOY: always()",
        )
        .replace(
          "if: ${{ always() && needs.release-plan.result == 'success' && needs.release-qa.result == 'success' }}",
          "if: ${{ needs.release-plan.result == 'success' && needs.release-qa.result == 'success' }}",
        )
        .replace(
          "if: ${{ always() && needs.release-plan.result == 'success' && needs.prepare-artifacts.result == 'success' && needs.release-plan.outputs.has_bases == 'true' }}",
          "if: ${{ needs.release-plan.result == 'success' && needs.prepare-artifacts.result == 'success' && needs.release-plan.outputs.has_bases == 'true' }}",
        )
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toEqual(
        expect.arrayContaining([
          '.github/workflows/package-release.yml release-qa must run after skipped Release Please during recovery.',
          '.github/workflows/package-release.yml prepare-artifacts must run after successful recovery QA.',
          '.github/workflows/package-release.yml publish-bases must run after successful recovery artifact preparation.',
        ]),
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects weakened or inverted terminal release auditing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
    try {
      const invalidWorkflow = validWorkflow
        .replace(
          "if: ${{ always() && needs.release-plan.result == 'success' }}\n    runs-on: ubuntu-latest\n    steps:\n      - name: Fail closed on skipped or failed release jobs",
          "if: ${{ always() }}\n    runs-on: ubuntu-latest\n    steps:\n      - name: Fail closed on skipped or failed release jobs",
        )
        .replace('[ "$HAS_BASES" = "true" ]', '[ "$HAS_BASES" = "false" ]')
        .replace('test "$PUBLISH_DEPENDENTS_RESULT" = "skipped"', 'true')
      await writeMinimalPackageReleaseProject(projectRoot, invalidWorkflow)

      const result = await validatePackageReleaseFiles(projectRoot)

      expect(result.violations).toContain(
        '.github/workflows/package-release.yml release outcome audit must match its exact fail-closed contract.',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})

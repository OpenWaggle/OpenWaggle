import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validatePackageReleaseFiles } from '../package-release-validator'
import {
  validWorkflow,
  writeMinimalPackageReleaseProject,
} from './package-release-validator.fixtures'

const DIRECT_PUBLISH = 'pnpm package-release:publish "$TARBALL"'
const JOB_INDENT_WIDTH = 2

export const DEDICATED_PUBLISH = 'node scripts/package-release-publish.ts "$TARBALL"'
export const NPM_VERSION_CHECK =
  '      - name: Verify trusted-publishing npm version\n        if: ${{ matrix.released == \'true\' }}\n        run: test "$(npm --version)" = "11.9.0"\n\n'
export const PUBLICATION_JOB_NAMES = ['publish-bases', 'publish-dependents'] as const
export const FORBIDDEN_INSTALL_STEPS = [
  '      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4\n        with:\n          version: 11.6.0\n',
  '      - name: Install dependencies\n        run: pnpm install --frozen-lockfile\n',
  '      - name: Install package manager\n        run: npm install --global npm@11.18.0\n',
] as const
export const MODIFIED_PUBLICATION_INVOCATIONS = [
  `${DEDICATED_PUBLISH} --dry-run`,
  'pnpm package-release:publish malicious.tgz',
  'pnpm exec tsx scripts/package-release-publish.ts "$TARBALL"',
] as const
export const INJECTED_PUBLICATION_COMMANDS = [
  'n\\pm publish malicious.tgz',
  "np''m publish malicious.tgz",
  '"$(printf npm)" publish malicious.tgz',
  '$NPM publish malicious.tgz',
  'npm --silent publish malicious.tgz',
] as const
export const WEAKENED_CAPABILITIES = [
  ['environment: npm', 'environment: production'],
  [
    'permissions:\n      id-token: write',
    'permissions:\n      contents: read\n      id-token: write',
  ],
] as const

export function workflowWithDedicatedPublisher() {
  return validWorkflow.replaceAll(DIRECT_PUBLISH, DEDICATED_PUBLISH)
}

export function replaceInJob(
  workflow: string,
  jobName: string,
  target: string,
  replacement: string,
) {
  const jobStart = workflow.indexOf(`  ${jobName}:`)
  if (jobStart === -1) throw new Error(`Missing workflow job ${jobName}.`)
  const nextJobOffset = workflow
    .slice(jobStart + JOB_INDENT_WIDTH)
    .search(/^ {2}[a-zA-Z0-9_-]+:/m)
  const jobEnd =
    nextJobOffset === -1 ? workflow.length : jobStart + JOB_INDENT_WIDTH + nextJobOffset
  return `${workflow.slice(0, jobStart)}${workflow
    .slice(jobStart, jobEnd)
    .replace(target, replacement)}${workflow.slice(jobEnd)}`
}

export async function validateWorkflow(workflow: string) {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-package-release-'))
  try {
    await writeMinimalPackageReleaseProject(projectRoot, workflow)
    return await validatePackageReleaseFiles(projectRoot)
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true })
  }
}

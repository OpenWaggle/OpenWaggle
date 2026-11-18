/** Repositories for the package documentation line tests, each removed after its test. */
import fs from 'node:fs/promises'
import { afterEach } from 'vitest'
import {
  createRepository as createPolicyRepository,
  git,
  repositoryTemplate,
  writeAndCommit,
} from './commit-policy.test-harness'

const repositories: string[] = []

afterEach(async () => {
  await Promise.all(
    repositories.splice(0).map((cwd) => fs.rm(cwd, { force: true, recursive: true })),
  )
})

/** A repository with the commit policy and nothing released, removed after each test. */
export async function createRepository() {
  const repository = await createPolicyRepository()
  repositories.push(repository.cwd)
  return repository
}

export const CONFIG = {
  'bump-minor-pre-major': true,
  'initial-version': '0.1.0',
  packages: {
    'packages/waggle-core': { component: 'waggle-core' },
    'packages/pi-waggle': { component: 'pi-waggle' },
  },
}

const releasedRepository = repositoryTemplate(async () => {
  const { baseline, cwd } = await createPolicyRepository()
  await writeAndCommit(
    cwd,
    'release-please-config.json',
    JSON.stringify(CONFIG),
    'ci: configure release please',
  )
  await writeAndCommit(
    cwd,
    '.release-please-manifest.json',
    JSON.stringify({ 'packages/waggle-core': '0.1.1', 'packages/pi-waggle': '0.1.1' }),
    'ci: record package versions',
  )
  await writeAndCommit(
    cwd,
    'website/src/content/docs/packages/waggle-core/0.1/index.md',
    'guide\n',
    'docs: core guide',
  )
  await writeAndCommit(
    cwd,
    'website/src/content/docs/packages/pi-waggle/0.1/index.md',
    'guide\n',
    'docs: pi guide',
  )
  await writeAndCommit(
    cwd,
    'packages/waggle-core/src/index.ts',
    'export {}\n',
    'fix(core): release 0.1.1',
  )
  await git(cwd, ['tag', 'waggle-core-v0.1.0'])
  await git(cwd, ['tag', 'waggle-core-v0.1.1'])
  await git(cwd, ['tag', 'pi-waggle-v0.1.1'])
  return { baseline, cwd }
})

export async function createReleasedRepository() {
  const repository = await releasedRepository()
  repositories.push(repository.cwd)
  return repository
}

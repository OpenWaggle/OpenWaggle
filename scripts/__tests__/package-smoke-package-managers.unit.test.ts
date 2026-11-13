import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertOutsideRepository,
  assertRequiredPackageManagers,
  availablePackageManagers,
  consumerPackageManagers,
} from '../package-smoke-package-managers'

describe('package smoke package managers', () => {
  it('probes package managers outside the repository and fails closed for required managers', async () => {
    const probeDirectories: string[] = []
    const available = await availablePackageManagers(
      '/tmp/openwaggle-package-manager-probe',
      [
        { name: 'npm', command: 'npm' },
        { name: 'yarn', command: 'yarn' },
      ],
      async (_candidate, cwd) => {
        probeDirectories.push(cwd)
      },
    )

    expect(available.map(({ name }) => name)).toEqual(['npm', 'yarn'])
    expect(probeDirectories).toEqual([
      '/tmp/openwaggle-package-manager-probe',
      '/tmp/openwaggle-package-manager-probe',
    ])
    expect(() => assertRequiredPackageManagers(available, ['npm', 'yarn'])).not.toThrow()
    expect(() => assertRequiredPackageManagers(available, ['npm', 'pnpm', 'yarn'])).toThrow(
      'Required package consumers are unavailable: pnpm.',
    )
  })

  it('keeps consumer projects outside the repository, whose packageManager pins Bun', () => {
    expect(() =>
      assertOutsideRepository('/tmp/openwaggle-package-smoke-1', '/work/repo'),
    ).not.toThrow()
    expect(() => assertOutsideRepository('/work/repo-smoke', '/work/repo')).not.toThrow()
    for (const inside of ['/work/repo', '/work/repo/.tmp/openwaggle-package-smoke-1']) {
      expect(() => assertOutsideRepository(inside, '/work/repo')).toThrow(
        'Package consumers must run outside the repository',
      )
    }
  })

  it('refuses to probe consumers inside the repository before running any manager', async () => {
    await expect(
      consumerPackageManagers(
        path.join(process.cwd(), '.tmp', 'openwaggle-package-smoke-1'),
        process.cwd(),
        [],
      ),
    ).rejects.toThrow('Package consumers must run outside the repository')
  })
})

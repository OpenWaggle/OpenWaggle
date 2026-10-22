import { lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { action, catalog, installActionCatalogFixture, scope } from './action-catalog.test-harness'

/** The device number the next identity read reports, as after a reboot renumbers the volume. */
const reportedDevice = vi.hoisted((): { value: string | null } => ({ value: null }))
vi.mock('../action-manifest-file', async (importOriginal) => {
  const original = await importOriginal<typeof import('../action-manifest-file')>()
  return {
    ...original,
    readActionWorkspaceIdentity: async (workspace: string) => {
      const identity = await original.readActionWorkspaceIdentity(workspace)
      return identity && reportedDevice.value
        ? { ...identity, device: reportedDevice.value }
        : identity
    },
  }
})

installActionCatalogFixture()
afterEach(() => {
  reportedDevice.value = null
})

/** Without birth times the device number is compared by design, so this case does not apply. */
const recordsBirthTime = (await lstat(tmpdir(), { bigint: true })).birthtimeNs !== 0n

it.skipIf(!recordsBirthTime)(
  'keeps a draft revision valid when only the volume device number changes',
  async () => {
    reportedDevice.value = '16777230'
    const before = await catalog.read(scope())
    reportedDevice.value = '16777233'
    const after = await catalog.read(scope())
    expect(after.revision).toBe(before.revision)
    await expect(
      catalog.edit(scope(), before.revision, {
        type: 'save-action',
        definition: action,
        storage: 'local',
      }),
    ).resolves.toMatchObject({ actions: [{ source: 'local', definition: action }] })
  },
)

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { releaseWorkspaceHandoffSeed } from '../git/workspace-handoff-snapshot'

it('surfaces a failure to release the durable Workspace handoff seed', async () => {
  const missingRepository = path.join(
    os.tmpdir(),
    `openwaggle-missing-handoff-repository-${randomUUID()}`,
  )

  await expect(
    releaseWorkspaceHandoffSeed(
      missingRepository,
      'refs/openwaggle/workspace-handoffs/release-failure',
    ),
  ).rejects.toThrow('Releasing Workspace handoff snapshot failed')
})

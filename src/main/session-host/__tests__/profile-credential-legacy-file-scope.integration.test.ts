import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateProfileCredential } from '../profile-credential'
import { stageProfileCredential } from '../profile-credential-destination'

describe('legacy file credential destination scope', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-file-scope-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it.each(['cli.secret', 'other.secret'])(
    'rejects an unbound legacy file pending on an exact-key retry to %s',
    async (targetName) => {
      const key = 'legacy-file-request'
      const first = await stageProfileCredential({
        destination: { kind: 'file', path: path.join(root, 'cli.secret') },
        stateRoot: root,
        profileName: 'reviewer',
        credential: generateProfileCredential(),
        stagingKey: key,
        replace: false,
      })
      const profile = createHash('sha256').update('reviewer').digest('hex')
      const operation = createHash('sha256').update(key).digest('hex')
      const legacyPath = path.join(
        root,
        'profile-credential-staging',
        `${profile}.${operation}.pending`,
      )
      await fs.rename(first.recoveryLocation, legacyPath)
      const original = await fs.readFile(legacyPath)

      await expect(
        stageProfileCredential({
          destination: { kind: 'file', path: path.join(root, targetName) },
          stateRoot: root,
          profileName: 'reviewer',
          credential: generateProfileCredential(),
          stagingKey: key,
          replace: false,
        }),
      ).rejects.toThrow(legacyPath)
      await expect(fs.readFile(legacyPath)).resolves.toEqual(original)
      expect(await fs.readdir(path.dirname(legacyPath))).toEqual([path.basename(legacyPath)])
    },
  )
})

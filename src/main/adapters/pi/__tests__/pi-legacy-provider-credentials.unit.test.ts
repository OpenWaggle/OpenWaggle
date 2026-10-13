import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateLegacyProviderCredentials } from '../pi-legacy-provider-credentials'

let agentDirectory = ''
let authPath = ''

beforeEach(async () => {
  agentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pi-credentials-'))
  authPath = path.join(agentDirectory, 'auth.json')
})

afterEach(async () => {
  await fs.rm(agentDirectory, { recursive: true, force: true })
})

describe('legacy provider credential migration', () => {
  it("copies a stored Azure login to Pi's new provider id, keeping the old entry and file mode", async () => {
    const azure = { type: 'api_key', key: 'secret', env: { AZURE_OPENAI_RESOURCE_NAME: 'team' } }
    await fs.writeFile(authPath, JSON.stringify({ 'azure-openai-responses': azure }), {
      mode: 0o600,
    })

    await expect(migrateLegacyProviderCredentials(authPath)).resolves.toBe(true)

    expect(JSON.parse(await fs.readFile(authPath, 'utf8'))).toEqual({
      'azure-openai-responses': azure,
      azure,
    })
    expect((await fs.stat(authPath)).mode & 0o777).toBe(0o600)
    await expect(fs.stat(`${authPath}.lock`)).rejects.toThrow()
  })

  it('leaves credentials without a renamed provider untouched', async () => {
    const content = JSON.stringify({ openai: { type: 'api_key', key: 'sk-1' } })
    await fs.writeFile(authPath, content, { mode: 0o600 })

    await expect(migrateLegacyProviderCredentials(authPath)).resolves.toBe(false)

    expect(await fs.readFile(authPath, 'utf8')).toBe(content)
  })

  it('does not create auth.json when there is none', async () => {
    await expect(migrateLegacyProviderCredentials(authPath)).resolves.toBe(false)

    await expect(fs.stat(authPath)).rejects.toThrow()
  })

  it('writes through a symlinked auth.json in place, under the lock Pi takes', async () => {
    const azure = { type: 'api_key', key: 'secret' }
    const targetDirectory = path.join(agentDirectory, 'dotfiles')
    const targetPath = path.join(targetDirectory, 'pi-auth.json')
    await fs.mkdir(targetDirectory)
    await fs.writeFile(targetPath, JSON.stringify({ 'azure-openai-responses': azure }), {
      mode: 0o640,
    })
    await fs.symlink(targetPath, authPath)

    await expect(migrateLegacyProviderCredentials(authPath)).resolves.toBe(true)

    expect((await fs.lstat(authPath)).isSymbolicLink()).toBe(true)
    expect(JSON.parse(await fs.readFile(targetPath, 'utf8'))).toEqual({
      'azure-openai-responses': azure,
      azure,
    })
    // Like Pi, the file keeps the mode its owner gave it.
    expect((await fs.stat(targetPath)).mode & 0o777).toBe(0o640)
    expect(await fs.readdir(targetDirectory)).toEqual(['pi-auth.json'])
  })

  it('waits for the lock Pi holds on the symlink path, not on its target', async () => {
    const targetPath = path.join(agentDirectory, 'pi-auth.json')
    const content = JSON.stringify({ 'azure-openai-responses': { type: 'api_key', key: 'k' } })
    await fs.writeFile(targetPath, content, { mode: 0o600 })
    await fs.symlink(targetPath, authPath)
    // Pi locks with proper-lockfile and `realpath: false`: `<auth.json>.lock`, beside the link.
    await fs.mkdir(`${authPath}.lock`)

    await expect(migrateLegacyProviderCredentials(authPath)).resolves.toBe(false)

    expect(await fs.readFile(targetPath, 'utf8')).toBe(content)
    await expect(fs.stat(`${targetPath}.lock`)).rejects.toThrow()
    await expect(fs.stat(`${authPath}.lock`)).resolves.toBeDefined()
  })
})

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
})

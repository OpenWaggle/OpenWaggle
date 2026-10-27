import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { offersPowerShellTool } from '../powershell-availability'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function directory() {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-pwsh-'))
  roots.push(root)
  return root
}

describe('offersPowerShellTool', () => {
  it('always offers PowerShell on Windows', () => {
    expect(offersPowerShellTool('win32', undefined)).toBe(true)
  })

  it('leaves PowerShell out on macOS and Linux without pwsh on the PATH', async () => {
    const empty = await directory()
    expect(offersPowerShellTool('darwin', empty)).toBe(false)
    expect(offersPowerShellTool('linux', undefined)).toBe(false)
  })

  it('offers PowerShell when an executable pwsh is on the PATH', async () => {
    const empty = await directory()
    const bin = await directory()
    const pwsh = path.join(bin, 'pwsh')
    await writeFile(pwsh, '#!/bin/sh\n')
    await chmod(pwsh, 0o755)
    expect(offersPowerShellTool('darwin', [empty, bin].join(path.delimiter))).toBe(true)
  })
})

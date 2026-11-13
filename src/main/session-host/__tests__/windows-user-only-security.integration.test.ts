import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sidString } from '../windows-security-descriptor'
import {
  currentUser,
  secureWindowsUserOnly,
  secureWindowsUserOnlyWith,
  windowsSecurityKernel,
} from '../windows-user-only-security'
import { verifyWindowsPipeInstances } from './windows-pipe-instances'

// advapi32 through bun:ffi, on a real Windows machine (the Electrobun probe job runs it).
describe.runIf(process.platform === 'win32')('Windows user-only security (advapi32)', () => {
  const roots: string[] = []
  const servers: net.Server[] = []
  const sockets: net.Socket[] = []
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    for (const server of servers.splice(0)) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  })

  function stateDirectory() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'user-only-'))
    roots.push(root)
    return root
  }

  async function listeningPipe() {
    const pipe = `\\\\.\\pipe\\openwaggle-user-only-${randomUUID()}`
    const server = net.createServer((socket) => void sockets.push(socket))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(pipe, resolve))
    return pipe
  }

  it('makes the state directory, the capability file and the pipe user-only', async () => {
    const directory = stateDirectory()
    const capability = path.join(directory, 'endpoint.capability')
    fs.writeFileSync(capability, 'x')
    const pipe = await listeningPipe()

    const { userSid } = await secureWindowsUserOnly([
      { kind: 'directory', path: directory },
      { kind: 'file', path: capability },
      { kind: 'pipe', path: pipe },
    ])

    expect(userSid).toBe(sidString(currentUser(windowsSecurityKernel())))
    expect(userSid).toMatch(/^S-1-5-21-(?:\d+-)+\d+$/u)
    expect(await verifyWindowsPipeInstances(pipe, 8)).toBe(userSid)
    // Securing again is idempotent: the read-back of a secured object passes as it is.
    await expect(
      secureWindowsUserOnly([
        { kind: 'directory', path: directory },
        { kind: 'file', path: capability },
      ]),
    ).resolves.toEqual({ userSid })
  })

  it('fails closed when an object keeps its inherited DACL', async () => {
    const file = path.join(stateDirectory(), 'inherited')
    fs.writeFileSync(file, 'x')
    // The real read-back of a file nothing secured: its DACL comes from the temp directory.
    const unsecured = { ...windowsSecurityKernel(), setNamed: () => 0 }

    expect(() => secureWindowsUserOnlyWith(unsecured, [{ kind: 'file', path: file }])).toThrow(
      'Windows user-only file security verification failed',
    )
  })

  it('fails on an object that does not exist', async () => {
    const missing = path.join(stateDirectory(), 'missing')
    await expect(secureWindowsUserOnly([{ kind: 'file', path: missing }])).rejects.toThrow(
      /file security failed at set \(Win32 code 2\)/u,
    )
    await expect(
      secureWindowsUserOnly([
        { kind: 'pipe', path: `\\\\.\\pipe\\openwaggle-missing-${randomUUID()}` },
      ]),
    ).rejects.toThrow(/pipe security failed at open \(Win32 code 2\)/u)
  })
})

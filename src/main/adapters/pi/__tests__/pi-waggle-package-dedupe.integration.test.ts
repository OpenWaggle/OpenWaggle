import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'

const directories: string[] = []

afterEach(async () => {
  await cleanupOpenWagglePiSessions()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A local Pi package whose extension registers one command. */
function piPackage(name: string, command: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'openwaggle-pi-package-'))
  directories.push(root)
  mkdirSync(path.join(root, 'dist'))
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name, type: 'module', pi: { extensions: ['./dist/extension.js'] } }),
  )
  writeFileSync(
    path.join(root, 'dist', 'extension.js'),
    `export default function (pi) {
  pi.registerCommand(${JSON.stringify(command)}, { handler: async () => {} })
  pi.on('context', (event) => ({ messages: event.messages.filter((m) => m.role !== 'custom') }))
}
`,
  )
  return root
}

describe('a Pi package the user installed', () => {
  it("is not loaded when it is pi-waggle, whose default extension would take over OpenWaggle's Waggle", async () => {
    const { session } = await createOpenWagglePiSession({
      piGlobalSettings: {
        packages: [
          piPackage('@openwaggle/pi-waggle', 'installed-waggle'),
          piPackage('some-other-package', 'other'),
        ],
      },
    })

    const commands = session.extensionRunner.getRegisteredCommands().map((command) => command.name)
    expect(commands).toContain('other')
    expect(commands).not.toContain('installed-waggle')
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { PackageBinStore } from '../mcp-package-runner-bin-store'
import type { ResolvedPackageBin } from '../mcp-package-runner-bins'

const directories: string[] = []

/** Removes every folder the fixtures made; call it in `afterEach`. */
export function removeScratchDirectories() {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
}

/** A temporary folder removed by `removeScratchDirectories`. */
export function scratchDirectory(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

/** A runner cache folder holding one package with a JavaScript bin. */
export function runnerCache(name = '@scope/server', bin: unknown = { server: 'dist/cli.js' }) {
  const root = scratchDirectory('ow-npx-')
  const binDirectory = path.join(root, 'node_modules', '.bin')
  const packageDir = path.join(root, 'node_modules', ...name.split('/'))
  mkdirSync(binDirectory, { recursive: true })
  mkdirSync(path.join(packageDir, 'dist'), { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, bin }))
  writeFileSync(path.join(packageDir, 'dist', 'cli.js'), '#!/usr/bin/env node\n')
  return { binDirectory, script: path.join(packageDir, 'dist', 'cli.js') }
}

export function memoryStore(): PackageBinStore {
  let saved: Record<string, ResolvedPackageBin> = {}
  return {
    load: () => ({ ...saved }),
    save: (entries) => {
      saved = { ...entries }
    },
  }
}

export const launchInput = {
  command: 'npx',
  args: ['-y', '@scope/server@latest', '--port', '9'],
  cwd: '/work',
  env: { PATH: '/usr/bin' },
}

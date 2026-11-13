import { describe, expect, it } from 'vitest'
import { collectScriptedElectronLaunchViolations } from '../standards/electron-automation'

describe('development app launches in the electron-automation standard', () => {
  it.each([
    ['spawn("pnpm", ["exec", "electron-vite", "dev"])', 1],
    ["import { spawn as run } from 'node:child_process'\nrun('x', ['electron-vite', 'dev'])", 1],
    ["electronDevInvocation('vite', [])", 1],
    ["spawn('tsx', ['scripts/run-electron-dev.ts', 'vite'])", 1],
    ["spawn('pnpm', ['run', 'dev'])", 1],
    ["spawn('pnpm', ['dev:debug:headed'])", 1],
    ["execSync('pnpm dev')", 1],
    ["const args = ['dev', '--']\nreturn { command: 'pnpm', args }", 1],
    ["spawn('pnpm', ['--filter', 'app', 'dev'])", 1],
    ["const args = ['dev', `--remote-debugging-port=${port}`]\nspawn('pnpm', args)", 1],
    ["spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm', 'dev'])", 1],
    ["spawn('corepack', ['pnpm', 'run', 'dev'])", 1],
    ["spawn(process.execPath, [process.env['npm_execpath'] ?? 'pnpm', 'dev'])", 1],
    ["spawn(process.execPath, [process.env.npm_execpath!, 'dev'])", 1],
    ["spawnSync('pnpm', ['install'])\nif (BUILD_CHANNEL === 'dev') {}", 0],
    ["run('pnpm', ['build'])\nconst CHANNELS = ['dev', 'beta', 'stable']", 0],
    ["const commands = ['pnpm install', 'pnpm dev']", 0],
  ] as const)('counts %s as %i development app launch', (source, launches) => {
    expect(collectScriptedElectronLaunchViolations('scripts/x.ts', source)).toHaveLength(launches)
    expect(collectScriptedElectronLaunchViolations('packages/x/y.ts', source)).toHaveLength(launches)
    expect(collectScriptedElectronLaunchViolations('scripts/start-electron-qa.ts', source)).toEqual([])
  })

  it("leaves the app's own code, which runs a project's pnpm dev for the user, to other rules", () => {
    expect(collectScriptedElectronLaunchViolations('src/main/x.ts', "spawn('pnpm', ['dev'])")).toEqual([])
  })
})

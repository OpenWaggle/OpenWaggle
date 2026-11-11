import { describe, expect, it } from 'vitest'
import { collectScriptedAppLaunchViolations } from '../standards/desktop-automation'

describe('development app launches in the desktop-automation standard', () => {
  it.each([
    ["spawn('bun', ['scripts/electrobun/dev.ts', '--debug'])", 1],
    ["import { devArguments } from '../electrobun/dev'", 1],
    ["spawn('bun', ['run', 'dev'])", 1],
    ["spawn(bunExecutable(), ['run', 'dev:debug:headed'])", 1],
    ["spawn(bunExecutable(), ['dev'])", 1],
    ["execSync('bun run dev')", 1],
    ["execSync('bun dev')", 1],
    ["const args = ['run', 'dev', '--', '--']\nreturn { command: bunExecutable(), args }", 1],
    ["spawn('bun', ['--filter', 'app', 'dev'])", 1],
    ["spawn('cmd.exe', ['/d', '/s', '/c', 'bun', 'run', 'dev'])", 1],
    ["spawn(process.execPath, [process.env.npm_execpath ?? 'bun', 'run', 'dev'])", 1],
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
    ["spawnSync(bunExecutable(), ['install'])\nif (BUILD_CHANNEL === 'dev') {}", 0],
    ["run('bun', ['run', 'build'])\nconst CHANNELS = ['dev', 'beta', 'stable']", 0],
    ["const commands = ['bun install', 'bun run dev']", 0],
  ] as const)('counts %s as %i development app launch', (source, launches) => {
    expect(collectScriptedAppLaunchViolations('scripts/x.ts', source)).toHaveLength(launches)
    expect(collectScriptedAppLaunchViolations('packages/x/y.ts', source)).toHaveLength(launches)
    expect(collectScriptedAppLaunchViolations('scripts/electrobun/dev.ts', source)).toEqual([])
  })

  it.each(["spawn('bun', ['run', 'dev'])", "spawn('pnpm', ['dev'])"])(
    "leaves the app's own code, which runs a project's %s for the user, to other rules",
    (source) => {
      expect(collectScriptedAppLaunchViolations('src/main/x.ts', source)).toEqual([])
    },
  )
})

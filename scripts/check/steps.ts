/**
 * The check step graph: every step `bun run check` and `bun run verify` run, what each depends on,
 * and the files it reads.
 *
 * Extension point: to add a gate step, append one `CheckStep` to `STEPS` and its id to the gate
 * lists in `GATES`. The runner (`./run.ts`) handles parallelism, logs, the timing report and the
 * failure output; a step only declares its command, dependencies, inputs and how its failures read.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import type { CheckGate, CheckStep, StepCommand } from './step-model'

const BUN = process.execPath
const require = createRequire(import.meta.url)

/** A package's CLI entry from its manifest's `bin`, run with Node like `node_modules/.bin` would. */
function packageBin(packageName: string, bin: string): StepCommand {
  const manifestPath = require.resolve(`${packageName}/package.json`)
  const manifest: unknown = require(manifestPath)
  const bins: unknown =
    manifest !== null && typeof manifest === 'object' ? Reflect.get(manifest, 'bin') : undefined
  const entry: unknown = bins !== null && typeof bins === 'object' ? Reflect.get(bins, bin) : bins
  if (typeof entry !== 'string') throw new Error(`${packageName} has no "${bin}" bin`)
  return ['node', path.join(path.dirname(manifestPath), entry)]
}

const TSC = packageBin('typescript', 'tsc')

function bunScript(script: string, ...args: string[]): StepCommand {
  return [BUN, script, ...args]
}

const SOURCE_FILES = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'
const LINT_FILES = [
  `{src,packages,scripts,website,functions,fixtures}/${SOURCE_FILES}`,
  'electron.vite.config.ts',
]
const LINT_CONFIG = [
  'oxlint.config.mts',
  'scripts/oxlint/**',
  'scripts/lint.ts',
  'tools/bun-lint/**',
]
const TYPESCRIPT_INPUTS = [SOURCE_FILES, 'tsconfig*.json', 'package.json', 'bun.lock']
const STANDARDS_IMPLEMENTATION = [
  'scripts/check-repository-standards.ts',
  'scripts/repository-package-boundaries.ts',
  'scripts/standards/**',
  'scripts/renderer-design-token-exemptions.json',
]

/** A package build: ESM and CommonJS output, as the package's own `build` script produces. */
function packageBuild(name: string, dependsOn: readonly string[] = []): CheckStep {
  const directory = `packages/${name}`
  return {
    id: `build:${name}`,
    summary: `build ${directory} (dist and dist-cjs) once for the steps that read it`,
    commands: [
      [...TSC, '-p', 'tsconfig.build.json'],
      [...TSC, '-p', 'tsconfig.cjs.json'],
      bunScript('../../scripts/write-cjs-package-json.ts'),
    ],
    cwd: directory,
    ...(dependsOn.length === 0
      ? {}
      : { dependsOn: dependsOn.map((dependency) => `build:${dependency}`) }),
    inputs: [`${directory}/src/**`, `${directory}/tsconfig*.json`, `${directory}/package.json`],
    cache: { outputs: [`${directory}/dist`, `${directory}/dist-cjs/package.json`] },
    findings: 'tsc',
    hint: `bun run --filter @openwaggle/${name} build`,
  }
}

const PACKAGE_BUILDS = [
  'build:waggle-core',
  'build:extension-sdk',
  'build:pi-waggle',
  'build:extension-react',
]
/** The packages type-aware analysis resolves through node_modules on a clean checkout. */
const PACKAGE_DEPENDENCY_BUILDS = ['build:waggle-core', 'build:extension-sdk']

export const STEPS: readonly CheckStep[] = [
  {
    id: 'commits',
    summary: 'Conventional Commits on this branch since its merge base with origin/main',
    commands: [bunScript('scripts/check-conventional-commits-local.ts')],
    inputs: [],
    findings: 'generic',
    hint: 'reword the listed commits (git rebase -i); see .agents/standards.md',
  },
  {
    id: 'typecheck',
    summary: 'tsc -b over the node, web and renderer-test projects',
    commands: [bunScript('scripts/check/typecheck.ts')],
    inputs: TYPESCRIPT_INPUTS,
    findings: 'lines',
    hint: 'bun run typecheck',
  },
  {
    id: 'installer',
    summary: 'build/installer.nsh compiles (skipped without NSIS unless REQUIRE_NSIS=1)',
    commands: [bunScript('scripts/check-installer-script.ts')],
    inputs: ['build/installer.nsh', 'scripts/check-installer-script.ts'],
    findings: 'generic',
    hint: 'bun run check:installer',
  },
  {
    id: 'contrast',
    summary: 'theme colors meet the contrast roles',
    commands: [bunScript('scripts/check-contrast.ts')],
    inputs: ['src/renderer/src/styles/**', 'packages/extension-sdk/src/theme-data.ts'],
    findings: 'generic',
    hint: 'bun run check:contrast',
  },
  {
    id: 'pi-runtime',
    summary: 'Pi packages, pins, age exclusions and patches align',
    commands: [bunScript('scripts/check-pi-runtime-alignment.ts')],
    inputs: ['package.json', 'packages/pi-waggle/package.json', 'bunfig.toml', 'patches/**'],
    findings: 'generic',
    hint: 'bun run check:pi-runtime',
  },
  {
    id: 'provenance',
    summary: 'no locked version lost the npm provenance earlier versions had',
    commands: [bunScript('scripts/check-provenance-downgrade.ts')],
    inputs: ['bun.lock'],
    findings: 'generic',
    hint: 'bun run check:provenance',
  },
  {
    id: 'dependency-pins',
    summary: 'every exact pin behind latest has a DEPENDENCIES.md row',
    commands: [bunScript('scripts/check-dependency-pins.ts')],
    inputs: ['package.json', '**/package.json', 'DEPENDENCIES.md', 'bun.lock'],
    findings: 'generic',
    hint: 'add or update the DEPENDENCIES.md row for the pin',
  },
  {
    id: 'usage-statistics-catalog',
    summary: 'the generated usage statistics catalog is current',
    commands: [bunScript('scripts/generate-usage-statistics-catalog.ts', '--check')],
    inputs: ['src/shared/usage-statistics/**', 'src/shared/constants/mcp.ts'],
    findings: 'generic',
    hint: 'bun run usage-statistics-catalog:generate',
  },
  packageBuild('waggle-core'),
  packageBuild('extension-sdk'),
  packageBuild('pi-waggle', ['waggle-core']),
  packageBuild('extension-react', ['extension-sdk']),
  {
    id: 'format',
    summary: 'oxfmt --list-different (.oxfmtrc.json decides the files)',
    commands: [bunScript('scripts/lint.ts', '--format-only')],
    inputs: [SOURCE_FILES, '.oxfmtrc.json'],
    changedFiles: {
      files: [SOURCE_FILES],
      fullRunOn: ['.oxfmtrc.json'],
      command: (files) => bunScript('scripts/lint.ts', '--format-only', ...files),
    },
    findings: 'lines',
    hint: 'bun run format',
  },
  {
    id: 'lint',
    summary: 'type-aware lint of oxlint.config.mts through the pinned bun lint canary',
    commands: [bunScript('scripts/lint.ts', '--lint-only')],
    dependsOn: PACKAGE_DEPENDENCY_BUILDS,
    inputs: [...LINT_FILES, ...LINT_CONFIG],
    changedFiles: {
      files: LINT_FILES,
      fullRunOn: LINT_CONFIG,
      command: (files) => bunScript('scripts/lint.ts', '--lint-only', ...files),
    },
    findings: 'lines',
    hint: 'fix the code (inline suppressions are banned); bun run lint:fix applies autofixes',
  },
  {
    id: 'repository-standards',
    summary: 'repository standards (scripts/check-repository-standards.ts)',
    commands: [bunScript('scripts/check-repository-standards.ts')],
    inputs: ['**'],
    changedFiles: {
      files: ['**'],
      fullRunOn: STANDARDS_IMPLEMENTATION,
      command: (files) => bunScript('scripts/check-repository-standards.ts', ...files),
    },
    findings: 'lines',
    hint: 'bun run check:repository-standards; each message names the rule to follow',
  },
  {
    id: 'react-compiler',
    summary: 'chat and composer components compile with the React Compiler',
    commands: [bunScript('scripts/check-react-compiler.ts')],
    inputs: ['src/renderer/src/**'],
    findings: 'generic',
    hint: 'bun run check:react-compiler',
  },
  {
    id: 'waggle-dead-code',
    summary: 'no production-unused Waggle code (fallow)',
    commands: [bunScript('scripts/check-waggle-dead-code.ts')],
    dependsOn: PACKAGE_DEPENDENCY_BUILDS,
    inputs: ['src/**', 'packages/*/src/**', '.fallowrc.jsonc'],
    findings: 'generic',
    hint: 'bun run check:waggle-dead-code',
  },
  {
    id: 'renderer-bundle',
    summary: 'electron-vite build, then the syntax, main-bundle and CSP budgets',
    commands: [
      [...packageBin('electron-vite', 'electron-vite'), 'build', '--logLevel', 'warn'],
      bunScript('scripts/check-syntax-bundle.ts'),
      bunScript('scripts/check-main-bundle.ts'),
      bunScript('scripts/check-renderer-csp.ts'),
    ],
    inputs: ['src/**', 'packages/*/src/**', 'electron.vite.config.ts', 'scripts/vite/**'],
    findings: 'generic',
    hint: 'bun run check:renderer-bundle',
  },
  {
    id: 'pi-main-bundle-smoke',
    summary: 'Pi bundled into the main chunk runs under Node and Electron as Node',
    commands: [bunScript('scripts/pi-main-bundle-smoke.ts')],
    inputs: ['src/main/**', 'packages/pi-waggle/src/**', 'scripts/support/**'],
    findings: 'generic',
    hint: 'bun run pi-main-bundle:smoke',
  },
  {
    id: 'package-release-validate',
    summary: 'package release configuration and workflows',
    commands: [bunScript('scripts/package-release-validator.ts')],
    inputs: ['release-please-config.json', '.release-please-manifest.json', '.github/**'],
    findings: 'generic',
    hint: 'bun run package-release:validate',
  },
  {
    id: 'api-snapshots',
    summary: 'published package APIs match their committed snapshots',
    commands: [bunScript('scripts/package-api-snapshots.ts', '--check')],
    dependsOn: PACKAGE_BUILDS,
    inputs: ['packages/**', 'scripts/api-snapshots/**'],
    findings: 'generic',
    hint: 'bun run api:snapshot:update if the API change is intended',
  },
  {
    id: 'package-docs',
    summary: 'generated package documentation is current',
    commands: [bunScript('scripts/package-documentation.ts', '--check')],
    inputs: ['packages/**', 'website/src/content/docs/**'],
    findings: 'generic',
    hint: 'bun run package-docs:update',
  },
  {
    id: 'package-smoke',
    summary: 'packed packages install and run in npm, pnpm and bun consumer projects',
    commands: [bunScript('scripts/package-smoke.ts', '--prebuilt')],
    dependsOn: PACKAGE_BUILDS,
    inputs: ['packages/**', 'scripts/package-smoke*.ts'],
    findings: 'generic',
    hint: 'bun run package:smoke',
  },
  {
    id: 'native-node',
    summary: 'native modules built for Node (cached)',
    commands: [bunScript('scripts/rebuild-native-deps.ts', 'node')],
    inputs: ['bun.lock'],
    findings: 'generic',
    hint: 'bun run prepare:native:node',
  },
  {
    id: 'test-unit',
    summary: 'unit tests (vitest.unit.config.ts)',
    commands: [[...packageBin('vitest', 'vitest'), 'run', '-c', 'vitest.unit.config.ts']],
    dependsOn: ['native-node'],
    inputs: ['**'],
    findings: 'vitest',
    hint: 'rerun one file: bun run test:unit:raw <file>',
  },
]

const STATIC_STEPS = [
  'typecheck',
  'installer',
  'contrast',
  'pi-runtime',
  'provenance',
  'dependency-pins',
  'usage-statistics-catalog',
  'format',
  'lint',
  'repository-standards',
  'react-compiler',
  'waggle-dead-code',
  'renderer-bundle',
  'pi-main-bundle-smoke',
  'package-release-validate',
  'api-snapshots',
  'package-docs',
  'package-smoke',
]

export const GATES: readonly CheckGate[] = [
  { id: 'check', summary: 'full static verification (CI Typecheck & Lint)', steps: STATIC_STEPS },
  {
    id: 'verify',
    summary: 'pre-push: commit policy, typecheck, format, lint, standards, unit tests',
    steps: ['commits', 'typecheck', 'format', 'lint', 'repository-standards', 'test-unit'],
  },
]

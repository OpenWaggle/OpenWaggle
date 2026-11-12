/**
 * Command and input helpers for the step graph in ./steps.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { CheckStep, StepCommand } from './step-model'
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from '../support/object-fields'

const BUN = process.execPath
const REPOSITORY_ROOT = path.join(import.meta.dirname, '..', '..')

/**
 * A root dependency's CLI entry from its manifest's `bin`. Read from node_modules directly: some
 * packages (react-doctor) export no package.json.
 */
const binManifestSchema = Schema.Struct({ bin: unknownField })

function packageBinEntry(packageName: string, bin: string) {
  const manifestPath = path.join(REPOSITORY_ROOT, 'node_modules', packageName, 'package.json')
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bins = objectFields(binManifestSchema, manifest)?.bin
  const entry: unknown = bins !== null && typeof bins === 'object' ? Reflect.get(bins, bin) : bins
  if (typeof entry !== 'string') throw new Error(`${packageName} has no "${bin}" bin`)
  return path.join(path.dirname(manifestPath), entry)
}

/** The CLI run with Node, as `node_modules/.bin` would. */
export function packageBin(packageName: string, bin: string): StepCommand {
  return ['node', packageBinEntry(packageName, bin)]
}

/** The same CLI on the Bun runtime, where the Vitest tiers run (ADR 0064). */
export function bunRuntimePackageBin(packageName: string, bin: string): StepCommand {
  return [BUN, '--bun', packageBinEntry(packageName, bin)]
}

const TSC = packageBin('typescript', 'tsc')

export function bunScript(script: string, ...args: string[]): StepCommand {
  return [BUN, script, ...args]
}

export const SOURCE_FILES = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'
export const LINT_FILES = [
  `{src,packages,scripts,website,functions,fixtures}/${SOURCE_FILES}`,
  'electron.vite.config.ts',
]
export const LINT_CONFIG = [
  'oxlint.config.mts',
  'scripts/oxlint/**',
  'scripts/lint.ts',
  'tools/bun-lint/**',
]
export const TYPESCRIPT_INPUTS = [SOURCE_FILES, 'tsconfig*.json', 'package.json', 'bun.lock']
export const STANDARDS_IMPLEMENTATION = [
  'scripts/check-repository-standards.ts',
  'scripts/repository-package-boundaries.ts',
  'scripts/standards/**',
  'scripts/renderer-design-token-exemptions.json',
]

/** A package build: ESM and CommonJS output, as the package's own `build` script produces. */
export function packageBuild(name: string, dependsOn: readonly string[] = []): CheckStep {
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

export const PACKAGE_BUILDS = [
  'build:waggle-core',
  'build:extension-sdk',
  'build:pi-waggle',
  'build:extension-react',
]
/** The packages type-aware analysis resolves through node_modules on a clean checkout. */
export const PACKAGE_DEPENDENCY_BUILDS = ['build:waggle-core', 'build:extension-sdk']

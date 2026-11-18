import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { nodeRuntime } from './support/node-runtime'

/**
 * Runs the tests of the code that ships or runs on Node.js on Node.js 24 (`bun run
 * test:node-runtime:raw` and `test:node-runtime:integration:raw`). The main process, preload,
 * shared code and packages ship on Electron's Node.js; the release scripts below run under plain
 * `node` in the workflows. Their test files are derived from the workflows, so a workflow that
 * starts running another script under `node` brings that script's tests into the Node run.
 */

const WORKFLOW_DIRECTORIES = ['.github/workflows', '.github/actions'] as const
const SCRIPT_TESTS_DIRECTORY = 'scripts/__tests__'
const FAILURE_EXIT_CODE = 1
const TIER_ARGUMENT_INDEX = 2
const ARGUMENT_START_INDEX = 3

const TIERS = {
  unit: {
    config: 'vitest.unit.config.ts',
    roots: ['src/main', 'src/preload', 'src/shared', 'packages'],
  },
  integration: { config: 'vitest.integration.config.ts', roots: ['src/main'] },
} as const
type NodeRuntimeTier = keyof typeof TIERS

// `node [--flag …] [.release-tooling/]scripts/<name>.ts`; `.release-tooling` is a checkout of the
// same scripts at the release tooling ref.
const NODE_SCRIPT_PATTERN =
  /(?:^|[\s"'(;&|$])node\s+(?:--\S+\s+)*(?:\.release-tooling\/)?scripts\/([\w./-]+)\.[cm]?ts\b/gmu

/** The `scripts/<name>` entries the workflow and composite action files run under `node`. */
export function workflowNodeScripts(workflows: readonly string[]) {
  const names = workflows.flatMap((workflow) =>
    [...workflow.matchAll(NODE_SCRIPT_PATTERN)].flatMap((match) => match[1] ?? []),
  )
  return [...new Set(names)].toSorted()
}

function readWorkflows(root: string) {
  return WORKFLOW_DIRECTORIES.flatMap((directory) =>
    fs
      .readdirSync(path.join(root, directory), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.ya?ml$/u.test(file))
      .map((file) => fs.readFileSync(path.join(root, directory, file), 'utf8')),
  )
}

/** Each workflow Node script with its test files in `scripts/__tests__` for one tier. */
export function workflowNodeScriptTests(root: string, tier: NodeRuntimeTier) {
  const testFiles = fs.readdirSync(path.join(root, SCRIPT_TESTS_DIRECTORY))
  const suffix = `.${tier}.test.ts`
  return workflowNodeScripts(readWorkflows(root)).map((script) => ({
    script,
    tests: testFiles
      .filter((file) => file.startsWith(`${script}.`) && file.endsWith(suffix))
      .map((file) => `${SCRIPT_TESTS_DIRECTORY}/${file}`),
  }))
}

/** The Vitest arguments of a tier's Node run. */
export function nodeRuntimeVitestArguments(root: string, tier: NodeRuntimeTier) {
  const { config, roots } = TIERS[tier]
  const scriptTests = workflowNodeScriptTests(root, tier).flatMap(({ tests }) => tests)
  return ['run', '-c', config, ...roots, ...scriptTests]
}

function isTier(value: string | undefined): value is NodeRuntimeTier {
  return value === 'unit' || value === 'integration'
}

if (import.meta.main) {
  const tier = process.argv[TIER_ARGUMENT_INDEX]
  if (!isTier(tier)) {
    console.error('Usage: bun scripts/node-runtime-tests.ts <unit|integration> [vitest arguments]')
    process.exit(FAILURE_EXIT_CODE)
  }
  const result = spawnSync(
    nodeRuntime().execPath,
    [
      'node_modules/vitest/vitest.mjs',
      ...nodeRuntimeVitestArguments(process.cwd(), tier),
      ...process.argv.slice(ARGUMENT_START_INDEX),
    ],
    { env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' }, stdio: 'inherit' },
  )
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? FAILURE_EXIT_CODE)
}

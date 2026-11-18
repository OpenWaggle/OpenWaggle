import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Schema } from '@shared/schema'
import { objectMap } from '../support/object-fields'
import { listTypedExports, readPackageJson } from '../support/package-declarations'

const run = promisify(execFile)
const PACKAGE_ROOT = path.resolve('packages/extension-sdk')
/** The tooling entries: they bundle the SDK's validator on purpose (ADR 0066). */
const TOOLING_ENTRIES = new Set(['./testing', './validation'])
const EFFECT_MODULE_PATH = /(?:^|\/)node_modules\/effect\//u
const BUNDLE_TIMEOUT_MS = 120_000
const metafileSchema = Schema.Struct({ inputs: Schema.Unknown })

let outputRoot = ''

beforeAll(async () => {
  outputRoot = await mkdtemp(path.join(tmpdir(), 'extension-sdk-bundles-'))
})

afterAll(async () => {
  await rm(outputRoot, { recursive: true, force: true })
})

/** The source module a package export's `dist/<name>.d.ts` is built from. */
function sourceEntry(declarationPath: string) {
  return path.join(
    PACKAGE_ROOT,
    declarationPath.replace(/^dist\//u, 'src/').replace(/\.d\.ts$/u, '.ts'),
  )
}

/** Bundles one entry the way an extension's browser build would, and lists what it pulled in. */
async function bundleEntry(entry: string) {
  const name = entry === '.' ? 'index' : entry.slice('./'.length)
  const outfile = path.join(outputRoot, `${name}.js`)
  const metafile = path.join(outputRoot, `${name}.meta.json`)
  const packageJson = await readPackageJson(PACKAGE_ROOT)
  const declarationPath = listTypedExports(packageJson).find(
    (candidate) => candidate.subpath === entry,
  )?.declarationPath
  if (declarationPath === undefined) throw new Error(`${entry} has no typed export.`)
  await run(
    'bun',
    [
      'build',
      '--minify',
      '--target=browser',
      `--outfile=${outfile}`,
      `--metafile=${metafile}`,
      sourceEntry(declarationPath),
    ],
    { cwd: outputRoot },
  )
  const metadata = Schema.decodeUnknownSync(metafileSchema)(
    JSON.parse(await readFile(metafile, 'utf8')),
  )
  const inputs = [...(objectMap(metadata.inputs)?.keys() ?? [])]
  return inputs
}

const entries = listTypedExports(await readPackageJson(PACKAGE_ROOT)).map(({ subpath }) => subpath)
const runtimeEntries = entries.filter((entry) => !TOOLING_ENTRIES.has(entry))

describe('extension SDK browser bundles', () => {
  // An extension imports these at run time; Effect in them would ship the validator to every frame.
  it.each(runtimeEntries)(
    'bundles %s without Effect',
    async (entry) => {
      const inputs = await bundleEntry(entry)
      expect(inputs.filter((input) => EFFECT_MODULE_PATH.test(input))).toEqual([])
    },
    BUNDLE_TIMEOUT_MS,
  )

  // The same bundler finds Effect where it is, so an empty list above means none, not a miss.
  it.each([...TOOLING_ENTRIES])(
    'bundles Effect into the %s tooling entry',
    async (entry) => {
      const inputs = await bundleEntry(entry)
      expect(inputs.some((input) => EFFECT_MODULE_PATH.test(input))).toBe(true)
    },
    BUNDLE_TIMEOUT_MS,
  )
})

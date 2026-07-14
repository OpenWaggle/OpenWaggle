import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { isRebuildMode, type RebuildMode } from './native-rebuild-cache'

const MODE_ARG_INDEX = 2
const require = createRequire(import.meta.url)

type DatabaseConstructor = new (filename: string) => unknown

function isDatabaseConstructor(value: unknown): value is DatabaseConstructor {
  return typeof value === 'function'
}

function isCloseFunction(value: unknown): value is () => void {
  return typeof value === 'function'
}

export function assertNativeModulesLoad(mode: RebuildMode) {
  const databaseConstructor: unknown = require('better-sqlite3')
  assertMatching(P.when(isDatabaseConstructor), databaseConstructor)

  const database = new databaseConstructor(':memory:')
  assertMatching({ close: P.when(isCloseFunction) }, database)
  database.close()

  if (mode === 'electron') {
    void require('node-pty')
    void require('sharp')
  }
}

function main() {
  const mode = process.argv[MODE_ARG_INDEX]
  if (!isRebuildMode(mode)) {
    throw new Error('Usage: native-load-probe.ts <node|electron>')
  }

  assertNativeModulesLoad(mode)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

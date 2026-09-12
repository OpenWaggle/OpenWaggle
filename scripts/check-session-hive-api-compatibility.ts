import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOST_ROOT_ARGUMENT = 2
const hostRootArgument = process.argv[HOST_ROOT_ARGUMENT]
if (!hostRootArgument) {
  throw new Error('Usage: pnpm exec tsx scripts/check-session-hive-api-compatibility.ts <host-checkout>')
}

const hostRoot = path.resolve(hostRootArgument)
const summaryRoot = process.cwd()
const evidenceDirectory = mkdtempSync(path.join(os.tmpdir(), 'openwaggle-hive-contract-'))
const configPath = path.join(evidenceDirectory, 'tsconfig.json')
const probePath = path.join(evidenceDirectory, 'probe.ts')
// Resolve @shared through the producer, not copied replacement API declarations.
const probe = `
import type { OpenWaggleApi } from ${JSON.stringify(path.join(hostRoot, 'src/shared/types/openwaggle-api'))}
import type { SessionHiveReader } from ${JSON.stringify(path.join(summaryRoot, 'src/renderer/src/queries/session-hive-contract'))}
import type { SessionHiveEventSource } from ${JSON.stringify(path.join(summaryRoot, 'src/renderer/src/queries/session-hive-events'))}
declare const producer: OpenWaggleApi
export const reader: Required<Pick<SessionHiveReader, 'listHiveSessionCatalogPage'>> = producer
export const events: Required<Pick<SessionHiveEventSource, 'onSessionHostEvent' | 'onSessionHostResyncRequired'>> = producer
`
writeFileSync(probePath, probe)
writeFileSync(configPath, JSON.stringify({
  extends: path.join(hostRoot, 'tsconfig.web.json'),
  compilerOptions: {
    composite: false, declaration: false, noEmit: true, noCheck: false,
    strict: true, strictNullChecks: true, noImplicitAny: true,
    rootDir: path.parse(summaryRoot).root, types: [],
  },
  include: [probePath], exclude: [], references: [],
}))
console.log(`Compatibility probe evidence: ${evidenceDirectory}`)
try {
  execFileSync('pnpm', ['exec', 'tsc', '-p', configPath], { cwd: summaryRoot, stdio: 'inherit' })
  console.log(`Session Summary reader and event contracts are compatible with ${hostRoot}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

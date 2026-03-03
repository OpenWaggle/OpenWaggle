import fs from 'node:fs/promises'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import * as ts from 'typescript'

const LEVEL = 9

const TS_PATTERN_BASELINE_RAW = 8130
const TS_PATTERN_BASELINE_GZIP = 2680

async function main() {
  const sourcePath = `${process.cwd()}/src/shared/utils/decision.ts`
  const source = await fs.readFile(sourcePath, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText

  const rawBytes = Buffer.byteLength(compiled)
  const gzipBytes = gzipSync(compiled, { level: LEVEL }).byteLength

  const rawOk = rawBytes < TS_PATTERN_BASELINE_RAW
  const gzipOk = gzipBytes < TS_PATTERN_BASELINE_GZIP

  console.log(
    `check-decision-size: raw=${rawBytes}B (limit ${TS_PATTERN_BASELINE_RAW}B), gzip=${gzipBytes}B (limit ${TS_PATTERN_BASELINE_GZIP}B)`,
  )

  if (rawOk && gzipOk) return

  console.error('check-decision-size: decision utility exceeds baseline size budget')
  process.exit(1)
}

void main()

import { readFileSync } from 'node:fs'
import { BaseSequencer, type TestSpecification } from 'vitest/node'

const ENVIRONMENT_DOCBLOCK = /@vitest-environment\s+([\w-]+)/u
const HEAD_BYTES = 2_048

function docblockEnvironment(file: string) {
  try {
    return ENVIRONMENT_DOCBLOCK.exec(readFileSync(file, 'utf8').slice(0, HEAD_BYTES))?.[1] ?? ''
  } catch {
    return ''
  }
}

/**
 * Vitest's default order, with the files that pick another environment by docblock moved after
 * the rest. A reused worker serves only files of its own environment, and Vitest stops it when the
 * next queued file needs another one, so interleaved environments restart workers.
 */
export class EnvironmentGroupedSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    const sorted = await super.sort(files)
    const environments = new Map(sorted.map((file) => [file, docblockEnvironment(file.moduleId)]))
    return sorted.toSorted((a, b) =>
      (environments.get(a) ?? '').localeCompare(environments.get(b) ?? ''),
    )
  }
}

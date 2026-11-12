/**
 * The no-cheating verdict: every way a change can get through by checking less, comparing the
 * working tree with a base commit. New suppressions and silencing casts, a weaker tsconfig, a
 * loosened lint config, a raised budget or grown only-shrinks list, skipped or deleted tests,
 * hand-edited generated files, and new open-record types. Each finding names its kind
 * (`no-cheating/<kind>`), which the "No cheating" section of .agents/standards.md lists.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Finding } from './findings'
import { generatedFileFindings } from './generated-files'
import { changedSince, listing, movedSince, textsAt } from './git-files'
import { lintConfigFindings } from './lint-config'
import { openRecordFindings } from './open-records'
import { ratchetFindings } from './ratchets'
import { deletedTestFindings, skippedTestFindings } from './skipped-tests'
import { newSuppressions } from './suppressions'
import { tsconfigFindings } from './tsconfig'

const MAX_TEXT_BYTES = 4 * 1024 * 1024

async function currentText(root: string, file: string) {
  try {
    const text = await readFile(path.join(root, file), 'utf8')
    return text.length > MAX_TEXT_BYTES ? undefined : text
  } catch {
    return undefined
  }
}

export async function noCheatingFindings(root: string, base: string): Promise<Finding[]> {
  const files = await changedSince(root, base)
  if (files.length === 0) return []
  const [before, afterTexts, listed, moved] = await Promise.all([
    textsAt(root, base, files),
    Promise.all(files.map((file) => currentText(root, file))),
    listing(root),
    movedSince(root, base),
  ])
  const after = new Map(files.map((file, index) => [file, afterTexts[index]]))
  const states = files.map((file) => ({ file, before: before.get(file), after: after.get(file) }))
  const perFile = states.flatMap((state) => [
    ...(state.after === undefined ? [] : newSuppressions(state.file, state.before, state.after)),
    ...lintConfigFindings(state.file, state.before, state.after),
    ...ratchetFindings(state.file, state.before, state.after),
    ...skippedTestFindings(state.file, state.before, state.after),
    ...openRecordFindings(state.file, state.before, state.after),
  ])
  const present = new Set(listed.split('\0'))
  const [deleted, tsconfig, generated] = await Promise.all([
    deletedTestFindings({
      changes: states.map((state) => ({
        file: state.file,
        existedBefore: state.before !== undefined,
        existsNow: present.has(state.file),
      })),
      moved,
      exists: (file) => Promise.resolve(present.has(file)),
      existed: async (file) => (await textsAt(root, base, [file])).get(file) !== undefined,
      textNow: (file) => currentText(root, file),
    }),
    tsconfigFindings({
      root,
      files,
      listing: listed,
      before: (file) =>
        before.has(file)
          ? Promise.resolve(before.get(file))
          : textsAt(root, base, [file]).then((texts) => texts.get(file)),
      after: (file) => currentText(root, file),
    }),
    generatedFileFindings(root, states),
  ])
  return [...perFile, ...deleted, ...tsconfig, ...generated]
}

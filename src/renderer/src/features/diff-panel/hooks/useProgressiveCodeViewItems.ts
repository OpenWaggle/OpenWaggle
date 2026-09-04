import type { GitFileDiff } from '@shared/types/git'
import { useEffect, useMemo, useState } from 'react'
import {
  type DiffParserWorkerRequest,
  type DiffParserWorkerResponse,
  decorateCodeViewItems,
  type ParsedReviewCodeViewItem,
  parseCodeViewItems,
  type ReviewAnnotation,
} from '@/features/diff-panel/lib/code-view-items'

const SYNCHRONOUS_FILE_LIMIT = 4
const FILES_PER_BUILD_SLICE = 4
const FILES_IN_FIRST_BUILD_SLICE = 1
// JavaScript parsers consume UTF-16 strings. Bounding code units avoids allocating another encoded
// copy merely to count bytes while still constraining the actual input the parser scans.
const MAIN_THREAD_PATCH_UNIT_BUDGET = 64 * 1024

interface BuiltItems {
  readonly files: readonly GitFileDiff[]
  readonly items: readonly ParsedReviewCodeViewItem[] | null
  readonly complete: boolean
  readonly error: string | null
}

function yieldToRenderer() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}

function patchUnits(files: readonly GitFileDiff[]) {
  return files.reduce((total, file) => total + file.diff.length, 0)
}

function nextSliceEnd(files: readonly GitFileDiff[], start: number) {
  let end = start
  let units = 0
  const fileLimit = start === 0 ? FILES_IN_FIRST_BUILD_SLICE : FILES_PER_BUILD_SLICE
  while (end < files.length && end - start < fileLimit) {
    const nextUnits = files[end]?.diff.length ?? 0
    if (nextUnits > MAIN_THREAD_PATCH_UNIT_BUDGET) break
    if (end > start && units + nextUnits > MAIN_THREAD_PATCH_UNIT_BUDGET) break
    units += nextUnits
    end += 1
    if (units >= MAIN_THREAD_PATCH_UNIT_BUDGET) break
  }
  return end
}

function createDiffParserWorker() {
  return new Worker(new URL('../workers/diff-parser.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function parseOversizedFileInWorker(file: GitFileDiff, worker: Worker) {
  return new Promise<readonly ParsedReviewCodeViewItem[]>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<DiffParserWorkerResponse>) => {
      const response = event.data
      if (response.ok) resolve(response.items)
      else reject(new Error(response.error))
    }
    worker.onerror = (event) => reject(new Error(event.message || 'Could not prepare this diff.'))
    worker.postMessage({ files: [file] } satisfies DiffParserWorkerRequest)
  })
}

function buildProgressively(files: readonly GitFileDiff[], onBuilt: (built: BuiltItems) => void) {
  let cancelled = false
  let activeWorker: Worker | null = null
  const build = async () => {
    await yieldToRenderer()
    if (cancelled) return
    const items: ParsedReviewCodeViewItem[] = []
    try {
      for (let index = 0; index < files.length; ) {
        const file = files[index]
        if (file === undefined) break
        if (file.diff.length > MAIN_THREAD_PATCH_UNIT_BUDGET) {
          const worker = createDiffParserWorker()
          activeWorker = worker
          const workerItems = await parseOversizedFileInWorker(file, worker)
          worker.terminate()
          activeWorker = null
          if (cancelled) return
          items.push(...workerItems)
          index += 1
          onBuilt({ files, items: [...items], complete: index === files.length, error: null })
          if (index < files.length) await yieldToRenderer()
          continue
        }
        const end = nextSliceEnd(files, index)
        if (end === index) throw new Error('Could not prepare this diff.')
        items.push(...parseCodeViewItems(files.slice(index, end)))
        if (cancelled) return
        index = end
        onBuilt({ files, items: [...items], complete: index === files.length, error: null })
        if (index < files.length) await yieldToRenderer()
      }
    } catch (error) {
      activeWorker?.terminate()
      activeWorker = null
      if (!cancelled) {
        onBuilt({
          files,
          items: null,
          complete: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  void build()
  return () => {
    cancelled = true
    activeWorker?.terminate()
  }
}

/**
 * Parse large patches without monopolising the renderer.
 *
 * Small diffs retain a zero-delay path. Multi-file patches are sliced by both file count and parser
 * input size, publishing the first batch immediately. A single oversized file cannot be subdivided
 * safely as a unified patch, so it is parsed in a short-lived worker before Pierre mounts its own
 * highlighting worker.
 */
export function useProgressiveCodeViewItems(
  files: readonly GitFileDiff[],
  annotationsByPath: ReadonlyMap<string, readonly ReviewAnnotation[]>,
) {
  const immediateItems = useMemo(
    () =>
      files.length <= SYNCHRONOUS_FILE_LIMIT && patchUnits(files) <= MAIN_THREAD_PATCH_UNIT_BUDGET
        ? parseCodeViewItems(files)
        : null,
    [files],
  )
  const [built, setBuilt] = useState<BuiltItems | null>(null)

  useEffect(() => {
    if (immediateItems !== null) return
    return buildProgressively(files, setBuilt)
  }, [files, immediateItems])

  const currentBuild = built?.files === files ? built : null
  const parsedItems = immediateItems ?? currentBuild?.items ?? null
  const items = useMemo(
    () => (parsedItems === null ? null : decorateCodeViewItems(parsedItems, annotationsByPath)),
    [parsedItems, annotationsByPath],
  )
  const preparedPaths = useMemo(
    () => new Set(parsedItems?.map((item) => item.filePath) ?? []),
    [parsedItems],
  )
  const preparationComplete = immediateItems !== null || currentBuild?.complete === true
  return { items, preparedPaths, preparationComplete, error: currentBuild?.error ?? null }
}

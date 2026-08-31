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
// JavaScript parsers consume UTF-16 strings. Bounding code units avoids allocating another encoded
// copy merely to count bytes while still constraining the actual input the parser scans.
const MAIN_THREAD_PATCH_UNIT_BUDGET = 64 * 1024

interface BuiltItems {
  readonly files: readonly GitFileDiff[]
  readonly items: readonly ParsedReviewCodeViewItem[] | null
  readonly error: string | null
}

function yieldToRenderer() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}

function patchUnits(files: readonly GitFileDiff[]) {
  return files.reduce((total, file) => total + file.diff.length, 0)
}

function shouldParseInWorker(files: readonly GitFileDiff[]) {
  return files.some((file) => file.diff.length > MAIN_THREAD_PATCH_UNIT_BUDGET)
}

function nextSliceEnd(files: readonly GitFileDiff[], start: number) {
  let end = start
  let units = 0
  while (end < files.length && end - start < FILES_PER_BUILD_SLICE) {
    const nextUnits = files[end]?.diff.length ?? 0
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

    if (shouldParseInWorker(files)) {
      const worker = createDiffParserWorker()
      worker.onmessage = (event: MessageEvent<DiffParserWorkerResponse>) => {
        const response = event.data
        setBuilt({
          files,
          items: response.ok ? response.items : null,
          error: response.ok ? null : response.error,
        })
        worker.terminate()
      }
      worker.onerror = (event) => {
        setBuilt({ files, items: null, error: event.message || 'Could not prepare this diff.' })
        worker.terminate()
      }
      worker.postMessage({ files } satisfies DiffParserWorkerRequest)
      return () => worker.terminate()
    }

    let cancelled = false
    const build = async () => {
      await yieldToRenderer()
      if (cancelled) return
      const items: ParsedReviewCodeViewItem[] = []
      try {
        for (let index = 0; index < files.length; ) {
          const end = nextSliceEnd(files, index)
          items.push(...parseCodeViewItems(files.slice(index, end)))
          if (cancelled) return
          setBuilt({ files, items: [...items], error: null })
          index = end
          if (index < files.length) await yieldToRenderer()
        }
      } catch (error) {
        if (!cancelled) {
          setBuilt({
            files,
            items: null,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void build()
    return () => {
      cancelled = true
    }
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
  return { items, preparedPaths, error: currentBuild?.error ?? null }
}

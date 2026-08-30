import { Editor, type EditorChangeEvent, type EditorOptions } from '@pierre/diffs/edit'
import { EditProvider, File, Virtualizer, WorkerPoolContextProvider } from '@pierre/diffs/react'
import type { WorkspaceDocumentChange } from '@shared/types/workspace-files'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { cn } from '@/shared/lib/cn'
import { pierreLanguageId } from '@/shared/lib/syntax/pierre-syntax-runtime'

const EDITOR_OVERSCROLL_PX = 600
const EDITOR_OBSERVER_MARGIN_PX = 1_200
const EDITOR_AST_CACHE_ENTRIES = 24
const EDITOR_OPTIONS: EditorOptions<undefined> = { persistState: false }

function createPierreWorker() {
  return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })
}

function workspaceChanges(event: EditorChangeEvent<undefined>): readonly WorkspaceDocumentChange[] {
  return event.changes.map((change) => ({
    rangeOffset: change.start,
    rangeLength: change.end - change.start,
    text: change.text,
  }))
}

export function FocusedSourceEditor({
  source,
  path,
  language,
  cacheKey,
  targetLine,
  wordWrap,
  className,
  ariaLabel,
  onChange,
  onSave,
}: {
  readonly source: string
  readonly path: string
  readonly language: string
  readonly cacheKey: string
  readonly targetLine?: number | null
  readonly wordWrap: boolean
  readonly className?: string
  readonly ariaLabel: string
  readonly onChange: (changes: readonly WorkspaceDocumentChange[], readSource: () => string) => void
  readonly onSave: () => void
}) {
  const { shikiTheme, variant } = useSyntaxTheme()
  const editorLanguage = pierreLanguageId(language)
  const changeHandler = useRef(onChange)
  const targetLineRef = useRef(targetLine)
  useEffect(() => {
    changeHandler.current = onChange
  }, [onChange])
  useEffect(() => {
    targetLineRef.current = targetLine
  }, [targetLine])
  const [createEditor] = useState(
    () => (options: EditorOptions<undefined>) =>
      new Editor<undefined>({
        ...options,
        clipboard: { readText: () => navigator.clipboard.readText() },
        onAttach: (editor, fileInstance) => {
          options.onAttach?.(editor, fileInstance)
          const lineNumber = targetLineRef.current
          if (lineNumber) editor.focus({ lineNumber })
          else editor.focus({ lineNumber: 'first-visible' })
        },
        onChange: (file, annotations, event) => {
          options.onChange?.(file, annotations, event)
          changeHandler.current(workspaceChanges(event), () => event.file.contents)
        },
      }),
  )
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    onSave()
  }

  return (
    <section
      aria-label={ariaLabel}
      className={cn('diff-chrome min-h-0 overflow-hidden bg-bg', className)}
      onKeyDownCapture={handleKeyDown}
    >
      <WorkerPoolContextProvider
        poolOptions={{
          workerFactory: createPierreWorker,
          poolSize: 1,
          totalASTLRUCacheSize: EDITOR_AST_CACHE_ENTRIES,
        }}
        highlighterOptions={{ langs: [editorLanguage] }}
      >
        <EditProvider createEditor={createEditor}>
          <Virtualizer
            className="h-full overflow-auto"
            contentClassName="min-h-full"
            config={{
              overscrollSize: EDITOR_OVERSCROLL_PX,
              intersectionObserverMargin: EDITOR_OBSERVER_MARGIN_PX,
            }}
          >
            <File
              file={{ name: path, contents: source, lang: editorLanguage, cacheKey }}
              edit
              editorOptions={EDITOR_OPTIONS}
              options={{
                disableFileHeader: true,
                overflow: wordWrap ? 'wrap' : 'scroll',
                theme: shikiTheme,
                themeType: variant.includes('light') ? 'light' : 'dark',
              }}
            />
          </Virtualizer>
        </EditProvider>
      </WorkerPoolContextProvider>
    </section>
  )
}

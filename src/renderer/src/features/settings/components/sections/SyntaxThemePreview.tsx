import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { DiffBlock } from '@/shared/ui/DiffBlock'
import { MarkdownDocument } from '@/shared/ui/MarkdownDocument'
import { Select } from '@/shared/ui/Select'
import { SourceView } from '@/shared/ui/SourceView'
import { StructuredPayload } from '@/shared/ui/StructuredPayload'

const HEX_MARKER = String.fromCodePoint(35)
const PREVIEW_CONTRAST = 68
const EDITOR_SAMPLE_LANGUAGES = ['typescript', 'python', 'rust', 'json'] as const
type EditorSampleLanguage = (typeof EDITOR_SAMPLE_LANGUAGES)[number]

const EDITOR_SAMPLES: Record<
  EditorSampleLanguage,
  { readonly label: string; readonly extension: string; readonly source: string }
> = {
  typescript: {
    label: 'TypeScript',
    extension: 'ts',
    source: `type WorkspaceTheme = {
  accent: string
  contrast: number
}

const appearance: WorkspaceTheme = {
  accent: "amber",
  contrast: 68,
}`,
  },
  python: {
    label: 'Python',
    extension: 'py',
    source: `from dataclasses import dataclass

@dataclass(frozen=True)
class WorkspaceTheme:
    accent: str
    contrast: int

appearance = WorkspaceTheme("amber", 68)`,
  },
  rust: {
    label: 'Rust',
    extension: 'rs',
    source: `struct WorkspaceTheme {
    accent: &'static str,
    contrast: u8,
}

let appearance = WorkspaceTheme {
    accent: "amber",
    contrast: 68,
};`,
  },
  json: {
    label: 'JSON',
    extension: 'json',
    source: `{
  "workspace": "OpenWaggle",
  "theme": "amber",
  "contrast": 68,
  "enabled": true
}`,
  },
}

function isEditorSampleLanguage(value: string): value is EditorSampleLanguage {
  return EDITOR_SAMPLE_LANGUAGES.some((language) => language === value)
}

const PREVIEW_PATCH = `diff --git a/theme-preview.ts b/theme-preview.ts
--- a/theme-preview.ts
+++ b/theme-preview.ts
@@ -1,5 +1,5 @@
 const themePreview: ThemeConfig = {
-  surface: "sidebar",
-  accent: "${HEX_MARKER}2563eb",
+  surface: "workspace",
+  accent: "${HEX_MARKER}f5a623",
   contrast: 68,
 }
`

const PREVIEW_SURFACES = ['editor', 'markdown', 'diff', 'data'] as const
type PreviewSurface = (typeof PREVIEW_SURFACES)[number]

const PREVIEW_LABELS: Record<PreviewSurface, string> = {
  editor: 'Editor',
  markdown: 'Markdown',
  diff: 'Diff',
  data: 'Data',
}

function PreviewContent({
  surface,
  theme,
  editorLanguage,
  onEditorLanguageChange,
}: {
  readonly surface: PreviewSurface
  readonly theme: string
  readonly editorLanguage: EditorSampleLanguage
  readonly onEditorLanguageChange: (language: EditorSampleLanguage) => void
}) {
  if (surface === 'editor') {
    const sample = EDITOR_SAMPLES[editorLanguage]
    return (
      <div className="flex h-52 min-w-0 flex-col bg-bg">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2">
          <span className="text-xs text-text-muted">Syntax sample</span>
          <Select
            selectSize="xs"
            aria-label="Preview language"
            value={editorLanguage}
            onChange={(event) => {
              const language = event.currentTarget.value
              if (isEditorSampleLanguage(language)) onEditorLanguageChange(language)
            }}
          >
            {EDITOR_SAMPLE_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {EDITOR_SAMPLES[language].label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">
          <SourceView
            source={sample.source}
            path={`syntax-theme-preview.${sample.extension}`}
            language={editorLanguage}
            theme={theme}
            className="min-h-0 flex-1"
            ariaLabel={`${sample.label} syntax theme preview`}
          />
        </div>
      </div>
    )
  }
  if (surface === 'markdown') {
    return (
      <MarkdownDocument theme={theme} className="h-52 overflow-auto bg-bg p-4">
        {
          'A workspace theme keeps prose readable beside code:\n\n```typescript\nconst answer: number = 42\n```'
        }
      </MarkdownDocument>
    )
  }
  if (surface === 'diff') {
    return <DiffBlock patch={PREVIEW_PATCH} view="unified" wrap theme={theme} />
  }
  return (
    <StructuredPayload
      value={{ theme: 'amber', contrast: PREVIEW_CONTRAST, enabled: true }}
      theme={theme}
      className="h-52 rounded-none bg-bg"
    />
  )
}

export function SyntaxThemePreview({ theme }: { readonly theme: string }) {
  const [surface, setSurface] = useState<PreviewSurface>('editor')
  const [editorLanguage, setEditorLanguage] = useState<EditorSampleLanguage>('typescript')

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg">
      <div className="flex items-center gap-0.5 border-b border-border bg-bg-secondary px-1.5">
        {PREVIEW_SURFACES.map((entry) => (
          <Button
            key={entry}
            type="button"
            variant="unstyled"
            aria-pressed={surface === entry}
            onClick={() => setSurface(entry)}
            className={`relative px-2 py-2 text-xs transition-colors ${
              surface === entry ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {PREVIEW_LABELS[entry]}
            {surface === entry ? (
              <span className="absolute inset-x-2 bottom-0 h-px bg-accent" />
            ) : null}
          </Button>
        ))}
      </div>
      <PreviewContent
        surface={surface}
        theme={theme}
        editorLanguage={editorLanguage}
        onEditorLanguageChange={setEditorLanguage}
      />
    </div>
  )
}

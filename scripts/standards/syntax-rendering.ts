import { withoutCommentLines } from './comment-stripping'

interface Violation {
  readonly file: string
  readonly message: string
}

const RAW_BLOCK_OWNERS = new Set([
  'src/renderer/src/shared/ui/AppErrorBoundary.tsx',
  'src/renderer/src/shared/ui/MarkdownCodeBlock.tsx',
  'src/renderer/src/shared/ui/PlainTextBlock.tsx',
  'src/renderer/src/shared/ui/SyntaxBlock.tsx',
])

const SHIKI_INFRASTRUCTURE_PREFIXES = ['src/renderer/src/shared/lib/syntax/']

export function collectSyntaxRenderingViolations(file: string, contents: string) {
  const normalized = file.replaceAll('\\', '/')
  if (normalized.includes('__tests__')) return []
  const violations: Violation[] = []
  const source = withoutCommentLines(contents)
  if (
    (normalized === 'package.json' && /"(?:@shikijs\/monaco|monaco-editor)"\s*:/u.test(source)) ||
    (normalized.startsWith('src/renderer/src/') &&
      /(?:from\s*|import\s*\()["'](?:@shikijs\/monaco|monaco-editor)(?:\/[^"']*)?["']/u.test(
        source,
      ))
  ) {
    violations.push({
      file: normalized,
      message:
        'Monaco is outside the review-first workspace architecture; use SourceView or the focused Pierre editor.',
    })
  }
  if (
    normalized === 'electron.vite.config.ts' &&
    !/worker\s*:\s*\{[\s\S]*?format\s*:\s*['"]es['"]/u.test(source)
  ) {
    violations.push({
      file: normalized,
      message:
        'Renderer workers must use ES modules so syntax grammars remain demand-loaded chunks.',
    })
  }
  if (
    normalized.startsWith('src/renderer/src/') &&
    normalized.endsWith('.tsx') &&
    !RAW_BLOCK_OWNERS.has(normalized) &&
    /<pre(?:\s|>)/u.test(source)
  ) {
    violations.push({
      file: normalized,
      message:
        'Render block content through SyntaxBlock, StructuredPayload, MarkdownDocument, DiffBlock, or PlainTextBlock.',
    })
  }
  if (
    normalized.startsWith('src/renderer/src/') &&
    !SHIKI_INFRASTRUCTURE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) &&
    /\b(?:createHighlighter|createHighlighterCore|getSingletonHighlighter)\b/u.test(source)
  ) {
    violations.push({
      file: normalized,
      message: 'Shiki highlighter construction belongs to the shared syntax infrastructure.',
    })
  }
  return violations
}

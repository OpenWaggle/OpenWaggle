import type { ReactNode } from 'react'
import type { Components } from 'react-markdown'
import { safeMarkdownComponents } from '@/shared/lib/markdown-link-components'
import { isReactElementWithProps } from '@/shared/lib/react-element-guard'
import { MarkdownCodeBlock } from '@/shared/ui/MarkdownCodeBlock'

export function fencedCodeLanguage(children: ReactNode) {
  if (!isReactElementWithProps<{ className?: string }>(children)) return undefined
  const className = children.props.className
  if (typeof className !== 'string') return undefined
  return /(?:^|\s)language-([^\s]+)/u.exec(className)?.[1]
}

export function createSyntaxMarkdownComponents(
  overrides: Components = {},
  options: { readonly theme?: string } = {},
): Components {
  return {
    ...safeMarkdownComponents,
    pre({ children }: { children?: ReactNode }) {
      return (
        <MarkdownCodeBlock language={fencedCodeLanguage(children)} theme={options.theme}>
          {children}
        </MarkdownCodeBlock>
      )
    },
    ...overrides,
  }
}

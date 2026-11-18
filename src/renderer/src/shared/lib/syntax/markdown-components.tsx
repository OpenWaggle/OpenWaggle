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

/**
 * Typed as a value: its inferred `Components` comes from a path of react-markdown that declarations
 * cannot name.
 */
export const createSyntaxMarkdownComponents: (
  overrides?: Components,
  options?: { readonly theme?: string },
) => Components = (overrides = {}, options = {}) => ({
  ...safeMarkdownComponents,
  pre({ children }: { children?: ReactNode }) {
    const language = fencedCodeLanguage(children)
    return (
      <MarkdownCodeBlock
        {...(language === undefined ? {} : { language })}
        {...(options.theme === undefined ? {} : { theme: options.theme })}
      >
        {children}
      </MarkdownCodeBlock>
    )
  },
  ...overrides,
})

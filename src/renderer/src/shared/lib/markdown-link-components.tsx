import type { ComponentPropsWithoutRef } from 'react'
import type { Components } from 'react-markdown'
import { isAllowedMarkdownUrl } from './markdown-safety'

export function SafeMarkdownLink({ href, children }: ComponentPropsWithoutRef<'a'>) {
  if (!href || !isAllowedMarkdownUrl(href)) {
    return <span>{children}</span>
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  )
}

export const safeMarkdownComponents: Components = {
  a: SafeMarkdownLink,
}

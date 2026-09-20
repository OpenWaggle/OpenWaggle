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

/** Chat Markdown images are projected through the Session-owned resource viewer, never fetched here. */
export function NonFetchingMarkdownImage({ alt }: ComponentPropsWithoutRef<'img'>) {
  return (
    <span className="text-text-tertiary" data-chat-markdown-image-placeholder="true">
      {alt ? `[Image: ${alt}]` : '[Image]'}
    </span>
  )
}

export const safeMarkdownComponents: Components = {
  a: SafeMarkdownLink,
}

import { describe, expect, it } from 'vitest'
import { remarkSessionLinks } from '../remark-session-links'

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

function paragraph(value: string): MarkdownNode {
  return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] }
}

function linkedParagraph(value: string) {
  const tree = paragraph(value)
  remarkSessionLinks()(tree)
  return tree.children?.[0]?.children
}

describe('remarkSessionLinks', () => {
  it('turns a Session link in text into a link node', () => {
    expect(linkedParagraph('Read openwaggle://sessions/session-1, then reply.')).toEqual([
      { type: 'text', value: 'Read ' },
      {
        type: 'link',
        url: 'openwaggle://sessions/session-1',
        children: [{ type: 'text', value: 'openwaggle://sessions/session-1' }],
      },
      { type: 'text', value: ', then reply.' },
    ])
  })

  it('links several Session links in one text node', () => {
    const nodes = linkedParagraph('openwaggle://sessions/a and openwaggle://sessions/b')
    expect(nodes?.filter((node) => node.type === 'link').map((node) => node.url)).toEqual([
      'openwaggle://sessions/a',
      'openwaggle://sessions/b',
    ])
  })

  it('links the canonical form of a link written in capitals or with a trailing slash', () => {
    expect(linkedParagraph('OPENWAGGLE://SESSIONS/abc and openwaggle://sessions/def/.')).toEqual([
      {
        type: 'link',
        url: 'openwaggle://sessions/abc',
        children: [{ type: 'text', value: 'OPENWAGGLE://SESSIONS/abc' }],
      },
      { type: 'text', value: ' and ' },
      {
        type: 'link',
        url: 'openwaggle://sessions/def',
        children: [{ type: 'text', value: 'openwaggle://sessions/def/' }],
      },
      { type: 'text', value: '.' },
    ])
  })

  it.each([
    'openwaggle://app/index.html',
    'openwaggle://sessions/session-1/items',
    'openwaggle://sessions/session-1?prompt=run',
    'xopenwaggle://sessions/session-1',
    `openwaggle://sessions/${'a'.repeat(513)}`,
  ])('leaves %s as text', (value) => {
    expect(linkedParagraph(value)).toEqual([{ type: 'text', value }])
  })

  it('leaves text that is already a link label alone', () => {
    const tree: MarkdownNode = {
      type: 'root',
      children: [
        {
          type: 'link',
          url: 'https://example.com',
          children: [{ type: 'text', value: 'openwaggle://sessions/session-1' }],
        },
      ],
    }
    remarkSessionLinks()(tree)
    expect(tree.children?.[0]?.children).toEqual([
      { type: 'text', value: 'openwaggle://sessions/session-1' },
    ])
  })
})

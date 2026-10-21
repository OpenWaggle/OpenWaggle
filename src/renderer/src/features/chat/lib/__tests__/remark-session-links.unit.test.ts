import { describe, expect, it } from 'vitest'
import { remarkSessionLinks } from '../remark-session-links'

function paragraph(value: string) {
  return { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] }
}

function linkedParagraph(value: string) {
  const tree = paragraph(value)
  remarkSessionLinks()(tree)
  return tree.children[0]?.children
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
    const tree = {
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
    expect(tree.children[0]?.children).toEqual([
      { type: 'text', value: 'openwaggle://sessions/session-1' },
    ])
  })
})

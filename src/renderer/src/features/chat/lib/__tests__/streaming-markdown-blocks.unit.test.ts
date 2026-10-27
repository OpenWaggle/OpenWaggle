import { describe, expect, it } from 'vitest'
import { splitStreamingMarkdown } from '../streaming-markdown-blocks'

function blockTexts(text: string) {
  return splitStreamingMarkdown(text).blocks.map((block) => block.text)
}

describe('splitStreamingMarkdown', () => {
  it('keeps text without a completed block as the tail', () => {
    expect(splitStreamingMarkdown('hello world no breaks')).toEqual({
      blocks: [],
      tail: { kind: 'markdown', start: 0, text: 'hello world no breaks' },
    })
    expect(splitStreamingMarkdown('single\nline break only').blocks).toEqual([])
  })

  it('ends a block after each blank line', () => {
    const text = 'paragraph one\n\nparagraph two\n\nparagraph three'
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [
        { start: 0, text: 'paragraph one\n\n' },
        { start: 15, text: 'paragraph two\n\n' },
      ],
      tail: { kind: 'markdown', start: 30, text: 'paragraph three' },
    })
  })

  it('keeps blank lines before a block with that block', () => {
    expect(blockTexts('one\n\n\n\ntwo\n\nthree')).toEqual(['one\n\n', '\n\ntwo\n\n'])
  })

  it('has no tail once the text ends a block', () => {
    expect(splitStreamingMarkdown('done\n\n').tail).toBeNull()
  })

  it('never ends a block inside fenced code', () => {
    const text = 'before\n\n  ```\ncode block\n\nstill in fence\n  ```\n\nafter fence'
    const { blocks, tail } = splitStreamingMarkdown(text)
    expect(blocks.map((block) => block.text)).toEqual([
      'before\n\n',
      '  ```\ncode block\n\nstill in fence\n  ```\n\n',
    ])
    expect(tail).toEqual({ kind: 'markdown', start: text.indexOf('after'), text: 'after fence' })
  })

  it('honors CommonMark tilde, indentation, and delimiter-length rules', () => {
    expect(blockTexts('~~~ts\none\n\ninside\n~~~\n\nafter')).toEqual([
      '~~~ts\none\n\ninside\n~~~\n',
    ])
    expect(blockTexts('   ```ts\none\n\ninside\n   ```\n\nafter')).toEqual([
      '   ```ts\none\n\ninside\n   ```\n\n',
    ])
    // Four spaces make indented code, not a fence.
    expect(blockTexts('    ```ts\nordinary indented code\n\nafter')).toEqual([
      '    ```ts\nordinary indented code\n\n',
    ])
    // A shorter run does not close a longer fence.
    expect(splitStreamingMarkdown('````ts\none\n```\n\nstill fenced').tail).toEqual({
      kind: 'open-fence',
      start: 0,
      language: 'ts',
      code: 'one\n```\n\nstill fenced',
    })
  })

  it('ends the block above a column-0 fence, and the fence after its closing line', () => {
    const text = 'Intro paragraph\n- item one\n- item two\n```ts\nconst a = 1\n```\nAfter the code'
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [
        { start: 0, text: 'Intro paragraph\n- item one\n- item two\n' },
        { start: text.indexOf('```ts'), text: '```ts\nconst a = 1\n```\n' },
      ],
      tail: { kind: 'markdown', start: text.indexOf('After'), text: 'After the code' },
    })
  })

  it('leaves an open column-0 fence unparsed as the tail, however long it grows', () => {
    const lines = Array.from({ length: 500 }, (_, index) => `line ${String(index)}`)
    const text = `Some code:\n\`\`\`typescript title="a.ts"\n${lines.join('\n')}`
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [{ start: 0, text: 'Some code:\n' }],
      tail: { kind: 'open-fence', start: 11, language: 'typescript', code: lines.join('\n') },
    })
  })

  it('reads a closing line still streaming as closing the fence', () => {
    expect(splitStreamingMarkdown('```ts\na\n```').tail).toEqual({
      kind: 'markdown',
      start: 0,
      text: '```ts\na\n```',
    })
  })

  it('treats a delimiter split across tokens as text until it is a fence', () => {
    expect(splitStreamingMarkdown('``').tail).toEqual({ kind: 'markdown', start: 0, text: '``' })
    expect(splitStreamingMarkdown('```').tail).toEqual({
      kind: 'open-fence',
      start: 0,
      language: null,
      code: '',
    })
  })

  it('does not split an HTML block at a fence line inside it', () => {
    expect(splitStreamingMarkdown('<div>\n```\ncode').blocks).toEqual([])
  })

  it('parses blocks together once one holds a link reference definition', () => {
    const text = '[OpenWaggle][docs]\n\nParagraph\n\n[docs]: https://openwaggle.dev\n\nTail'
    expect(splitStreamingMarkdown(text).blocks).toEqual([
      { start: 0, text: '[OpenWaggle][docs]\n\nParagraph\n\n[docs]: https://openwaggle.dev\n\n' },
    ])
    expect(blockTexts('Intro\n\n> - [x]: https://example.com\n\nTail')).toHaveLength(1)
  })
})

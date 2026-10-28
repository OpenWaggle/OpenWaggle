import type { Root } from 'hast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { completedMarkdownBlocks, splitStreamingMarkdown } from '../streaming-markdown-blocks'

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

  it('ends a block at a blank line only once the next line shows it does not go on', () => {
    expect(splitStreamingMarkdown('done\n\n')).toEqual({
      blocks: [],
      tail: { kind: 'markdown', start: 0, text: 'done\n\n' },
    })
    expect(blockTexts('done\n\nn')).toEqual(['done\n\n'])
  })

  it('has no tail once a closed fence ends the text', () => {
    expect(splitStreamingMarkdown('```\na\n```\n').tail).toBeNull()
  })

  it('keeps a loose list together across its blank lines', () => {
    const text = '1. Install it:\n\n   Run the installer first.\n\n2. Configure it\n\nDone.'
    expect(blockTexts(text)).toEqual([
      '1. Install it:\n\n   Run the installer first.\n\n2. Configure it\n\n',
    ])
    // A list's next item may still be streaming its marker.
    expect(blockTexts('- one\n\n-')).toEqual([])
    expect(blockTexts('1. one\n\n12')).toEqual([])
    expect(blockTexts('- one\n\nAfter')).toEqual(['- one\n\n'])
  })

  it('keeps a block together with a line indented as code after its blank line', () => {
    expect(blockTexts('Paragraph\n\n    code\n\nAfter')).toEqual(['Paragraph\n\n    code\n\n'])
    expect(blockTexts('- item\n\n\tcode\n\nAfter')).toEqual(['- item\n\n\tcode\n\n'])
  })

  it('keeps a raw HTML block together across its blank lines', () => {
    expect(blockTexts('<!--\n\nhidden\n\n-->\n\nAfter')).toEqual(['<!--\n\nhidden\n\n-->\n\n'])
    expect(blockTexts('<pre>\n\n  x\n</pre>\n\nAfter')).toEqual(['<pre>\n\n  x\n</pre>\n\n'])
    expect(blockTexts('<!-- one line -->\n\nAfter')).toEqual(['<!-- one line -->\n\n'])
  })

  it('reads the text before a split tail as the blocks the split found', () => {
    const text = 'One\n\n- a\n\n  b\n\nTwo\n\n```\ncode\n```\nThree'
    const split = splitStreamingMarkdown(text)
    const prefix = text.slice(0, split.tail?.start ?? text.length)
    expect(completedMarkdownBlocks(prefix)).toEqual(split.blocks)
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

  it('reads text holding a reference definition as one document, its tail included', () => {
    const text = '[OpenWaggle][docs]\n\nParagraph\n\n[docs]: https://openwaggle.dev\n\nTail'
    expect(splitStreamingMarkdown(text)).toEqual({
      blocks: [],
      tail: { kind: 'markdown', start: 0, text },
    })
    // Still streaming, the definition resolves the reference in the block above it.
    expect(blockTexts('[OpenWaggle][docs]\n\n[docs]: https://open')).toEqual([])
    expect(blockTexts('Intro\n\n> - [x]: https://example.com\n\nTail')).toEqual([])
    expect(blockTexts('A claim.[^1]\n\n[^1]: The source.')).toEqual([])
  })
})

/*
 * Each block is parsed as a document of its own while the answer streams; settled, the answer is
 * one document. For every prefix ending at a line boundary, the blocks and the tail must read as
 * that prefix does (PR #391 review R2 P2-1: loose lists, item paragraphs and code in items rendered
 * differently while streaming).
 */
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)

/** A document's top-level nodes without source positions or the line breaks between them. */
function parse(markdown: string): unknown {
  const root: Root = processor.runSync(processor.parse(markdown))
  const nodes = root.children.filter((child) => child.type !== 'text' || child.value.trim() !== '')
  return JSON.parse(JSON.stringify(nodes, (key, value) => (key === 'position' ? undefined : value)))
}

/** What the streaming view reads: each completed block, then the tail, each a document. */
function streamedReading(text: string) {
  const { blocks, tail } = splitStreamingMarkdown(text)
  const documents = [
    ...blocks.map((block) => block.text),
    ...(tail ? [text.slice(tail.start)] : []),
  ]
  return documents.flatMap((document) => parse(document))
}

function lineBoundaryPrefixes(text: string) {
  const prefixes: string[] = []
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) {
    prefixes.push(text.slice(0, index + 1))
  }
  return [...prefixes, text]
}

const CORPUS: Readonly<Record<string, string>> = {
  'loose ordered list with item paragraphs': [
    '1. Install it:',
    '',
    '   Run the installer first.',
    '',
    '2. Configure it',
    '',
    '   Edit the settings.',
    '',
    'All done.',
  ].join('\n'),
  'loose bullet list': '- one\n\n- two\n\n- three\n\nAfter the list.',
  'indented code in an item': '- item\n\n      indented code\n\n      more\n\n- next\n\nEnd',
  'fence in an item with a blank line': [
    '1. Run:',
    '',
    '   ```sh',
    '   pnpm install',
    '',
    '   pnpm test',
    '   ```',
    '',
    '2. Check it',
  ].join('\n'),
  'nested list with a deep fence': [
    '- outer',
    '',
    '  - inner',
    '',
    '        ```ts',
    '        const a = 1',
    '',
    '        const b = 2',
    '        ```',
    '',
    '  - inner two',
    '',
    'Paragraph',
  ].join('\n'),
  'block quotes': '> quoted\n> more\n\n> another quote\n\n> - a list\n>\n> - in a quote\n\nText',
  footnotes: 'A claim.[^1]\n\nMore text.\n\n[^1]: The source.\n\n    Its second paragraph.\n\nEnd',
  'reference definitions': '[OpenWaggle][docs] is here.\n\n[docs]: https://openwaggle.dev\n\nAfter',
  'paragraphs, headings and a table': [
    '# Title',
    '',
    'Intro paragraph',
    'continues here.',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '## Next',
    '',
    'Text.',
  ].join('\n'),
  'top-level fences and indented code': [
    'Code:',
    '',
    '```ts',
    'one',
    '',
    'two',
    '```',
    'After the fence.',
    '',
    '    indented',
    '',
    '    still indented',
    '',
    'Done.',
  ].join('\n'),
  'raw HTML blocks': '<!--\n\na comment\n\n-->\n\n<div>\nblock\n</div>\n\nText',
  'list then a different list': '- a\n\n1. b\n\n2. c\n\n* d\n\nText',
}

describe('streamed blocks read as the whole text', () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    it(`reads every prefix of ${name} as the settled document does`, () => {
      for (const prefix of lineBoundaryPrefixes(text)) {
        expect(streamedReading(prefix), JSON.stringify(prefix)).toEqual(parse(prefix))
      }
    })
  }
})

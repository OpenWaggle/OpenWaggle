import { describe, expect, it } from 'vitest'
import { lazySurfaceChunkFiles, parseRendererManifest } from '../renderer-chunk-graph'

const manifest = parseRendererManifest({
  'src/main.tsx': { file: 'assets/index.js', imports: ['_react.js'] },
  '_react.js': { file: 'assets/react.js' },
  'src/routes/_chat.index.tsx?tsr-split=component': {
    file: 'assets/_chat.index.js',
    imports: ['_react.js', '_chat-state.js'],
  },
  'src/routes/-chat-route-surface.tsx': {
    file: 'assets/-chat-route-surface.js',
    imports: ['_chat-state.js', '_markdown.js'],
  },
  '_chat-state.js': { file: 'assets/chat-state.js' },
  '_markdown.js': { file: 'assets/markdown.js', imports: ['_chat-state.js'] },
  'src/features/diff/DiffPanel.tsx': { file: 'assets/DiffPanel.js', imports: ['_react.js'] },
})

describe('lazySurfaceChunkFiles', () => {
  it('counts the static closure of a lazy surface outside the initial graph', () => {
    expect(
      lazySurfaceChunkFiles(
        manifest,
        [/^src\/routes\/_chat\.index\.tsx/u, /^src\/routes\/-chat-route-surface\.tsx$/u],
        new Set(['assets/index.js', 'assets/react.js']),
      ),
    ).toEqual([
      'assets/-chat-route-surface.js',
      'assets/_chat.index.js',
      'assets/chat-state.js',
      'assets/markdown.js',
    ])
  })

  it('fails instead of measuring nothing when a surface source has no chunk', () => {
    expect(() =>
      lazySurfaceChunkFiles(manifest, [/^src\/routes\/renamed\.tsx$/u], new Set()),
    ).toThrow('No renderer chunk for /^src\\/routes\\/renamed\\.tsx$/u')
  })
})

describe('parseRendererManifest', () => {
  it('rejects malformed manifests', () => {
    expect(() => parseRendererManifest([])).toThrow('not an object')
    expect(() => parseRendererManifest({ entry: { imports: [] } })).toThrow('Malformed')
  })
})

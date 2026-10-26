import { Linter } from 'eslint'
import babelParser from '@babel/eslint-parser'
import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin'

const RULE_NAME = 'openwaggle/no-uncaught-void-ipc'

function lint(code: string) {
  const linter = new Linter({ configType: 'flat' })
  return linter.verify(
    code,
    {
      files: ['**/*.tsx'],
      languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        parser: babelParser,
        parserOptions: {
          babelOptions: {
            parserOpts: {
              plugins: ['typescript', 'jsx'],
            },
          },
          ecmaFeatures: { jsx: true },
          requireConfigFile: false,
        },
      },
      plugins: {
        openwaggle: openwagglePlugin,
      },
      rules: {
        [RULE_NAME]: 'error',
      },
    },
    { filename: 'src/renderer/src/features/example/example-feature.tsx' },
  )
}

const WITH_BRIDGE_IMPORT = "import { api } from '@/shared/lib/ipc'\n"

describe('openwaggle/no-uncaught-void-ipc', () => {
  it('reports a bare void api call with no rejection handler', () => {
    const messages = lint(`${WITH_BRIDGE_IMPORT}void api.openExternal(url)\n`)
    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.ruleId).toBe(RULE_NAME)
  })

  it('reports a void api chain that ends in a single-argument then', () => {
    const messages = lint(
      `${WITH_BRIDGE_IMPORT}void api.showConfirm('Delete?', 'This cannot be undone.').then((confirmed) => {\n  if (confirmed) actions.delete(sessionId)\n})\n`,
    )
    expect(messages).toHaveLength(1)
  })

  it('reports a void api chain across a member call on the result', () => {
    const messages = lint(
      `${WITH_BRIDGE_IMPORT}void api.registerExtensionFrame({ frameId }).then((result) => {\n  frame.src = result.frameUrl\n})\n`,
    )
    expect(messages).toHaveLength(1)
  })

  it('reports a void api call inside a JSX event handler', () => {
    const messages = lint(
      `${WITH_BRIDGE_IMPORT}export function Toolbar({ tab }: { tab: Tab }) {\n  return <Button onClick={() => void api.openExternal(tab.url)}>Open</Button>\n}\n`,
    )
    expect(messages).toHaveLength(1)
  })

  it('reports a void api chain that ends in finally without a catch', () => {
    const messages = lint(
      `${WITH_BRIDGE_IMPORT}void api.cancelBrowserPreviewElementPick(previewId).finally(() => setBusy(null))\n`,
    )
    expect(messages).toHaveLength(1)
  })

  it('allows a void api chain that ends in catch', () => {
    const messages = lint(`${WITH_BRIDGE_IMPORT}void api.closeBrowserPreview(previewId).catch(() => undefined)\n`)
    expect(messages).toHaveLength(0)
  })

  it('allows a void api chain whose then carries a rejection handler', () => {
    const messages = lint(
      `${WITH_BRIDGE_IMPORT}void api.watchWorkspaceFiles(projectPath).then(\n  (canonical) => {\n    canonicalProjectPath = canonical\n  },\n  (error: unknown) => {\n    reportError(error)\n  },\n)\n`,
    )
    expect(messages).toHaveLength(0)
  })

  it('allows a void api chain with a catch before a trailing finally', () => {
    const messages = lint(
      `${WITH_BRIDGE_IMPORT}void api.pickBrowserPreviewElement(previewId).then((annotation) => {\n  append(annotation)\n}).catch((error: unknown) => {\n  onError(error)\n}).finally(() => setBusy(null))\n`,
    )
    expect(messages).toHaveLength(0)
  })

  it('allows void calls that are not rooted at the IPC bridge', () => {
    const messages = lint(`${WITH_BRIDGE_IMPORT}void session.paste()\nvoid controls.runState(() => api.reloadBrowserPreview(id), 'Could not reload.')\n`)
    expect(messages).toHaveLength(0)
  })

  it('allows a void api call when api is not the IPC bridge import', () => {
    const messages = lint(
      "import { api } from './other-module'\nvoid api.openExternal(url)\n",
    )
    expect(messages).toHaveLength(0)
  })
})
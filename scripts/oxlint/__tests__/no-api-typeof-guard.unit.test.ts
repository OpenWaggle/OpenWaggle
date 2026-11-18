import { describe, expect, it } from 'vitest'
import { openwagglePlugin } from '../openwaggle-plugin.ts'
import { lintWithRule } from './lint-rule.ts'

const RULE_NAME = 'openwaggle/no-api-typeof-guard'

function lint(code: string) {
  return lintWithRule(
    openwagglePlugin,
    RULE_NAME,
    code,
    'src/renderer/src/features/example/example-feature.tsx',
  )
}

const WITH_BRIDGE_IMPORT = "import { api } from '@/shared/lib/ipc'\n"

describe('openwaggle/no-api-typeof-guard', () => {
  it.each([
    ['a negated guard', "if (typeof api.getAppVersion !== 'function') stop()\n"],
    ['a positive guard', "const ok = typeof api.checkForUpdates === 'function'\n"],
    ['an optional member', "if (typeof api?.onUpdateStatus !== 'function') stop()\n"],
    ['a computed member', "if (typeof api['installUpdate'] !== 'function') stop()\n"],
  ])('reports %s on the bridge api', (_name, code) => {
    const messages = lint(`${WITH_BRIDGE_IMPORT}${code}`)
    expect(messages).toHaveLength(1)
    expect(messages.at(0)?.ruleId).toBe(RULE_NAME)
  })

  it('reports a guard on window.api or globalThis.api without the bridge import', () => {
    const messages = lint(
      "if (typeof window.api.getAppVersion !== 'function') stop()\nconst ok = typeof globalThis.api?.getHomeDirectory === 'function'\n",
    )
    expect(messages).toHaveLength(2)
  })

  it('allows type queries, other objects and an api that is not the bridge', () => {
    expect(
      lint(
        `${WITH_BRIDGE_IMPORT}type Version = Awaited<ReturnType<typeof api.getAppVersion>>\nconst modal = typeof dialog.showModal === 'function'\nconst isBridge = typeof api === 'object'\n`,
      ),
    ).toHaveLength(0)
    expect(
      lint("const api = createApi()\nconst ok = typeof api.read === 'function'\n"),
    ).toHaveLength(0)
  })
})

import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'

/**
 * An inline extension registering the virtual model `router/auto`, which routes every request to
 * the physical `test-provider/<target>` model, as a user's router extension would.
 */
export function autoRouterExtension(target: string): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerVirtualModel({
      provider: 'router',
      id: 'auto',
      name: 'Auto',
      thinkingLevels: ['low', 'high'],
      route: (_request, ctx) => {
        const model = ctx.modelRegistry.find('test-provider', target)
        if (!model) throw new Error(`The test router cannot find test-provider/${target}`)
        return { model, thinkingLevel: 'medium' }
      },
    })
  }
}

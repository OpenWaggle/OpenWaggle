/**
 * A small, faithful stand-in for the `electrobun/main` APIs the desktop shell adapters call, for
 * running the port contract suites against `src/main/adapters/electrobun/` without a native
 * Electrobun process. `prepareElectrobunShell()` reloads it for every contract case, so each case
 * starts from a clean fake. It models observable behavior (the clipboard, what the OS was handed,
 * the build configuration), not Electrobun internals.
 *
 * Each area of the shell keeps its fakes in its own `fake-electrobun-<area>.ts` and adds them to
 * `module` here.
 */
type BuildEnvironment = 'dev' | 'canary' | 'stable'
type Renderer = 'native' | 'cef'

export function fakeElectrobun() {
  const clipboardState: { text: string | null; image: Uint8Array | null } = {
    text: null,
    image: null,
  }
  const handed: string[] = []
  const trashed: string[] = []
  const shellState = { handed, trashed, refuse: false }
  const availableRenderers: Renderer[] = ['native', 'cef']
  const buildEnvironment: BuildEnvironment = 'dev'
  const defaultRenderer: Renderer = 'native'
  const buildState = { buildEnvironment, defaultRenderer, availableRenderers }

  function handOver(kind: string, target: string) {
    if (shellState.refuse) return false
    shellState.handed.push(`${kind}:${target}`)
    return true
  }

  const Utils = {
    openExternal: (url: string) => handOver('external', url),
    openPath: (target: string) => handOver('path', target),
    showItemInFolder: (target: string) => void handOver('folder', target),
    moveToTrash: (target: string) => {
      if (shellState.refuse) return false
      shellState.trashed.push(target)
      return true
    },
    clipboardReadText: () => clipboardState.text,
    clipboardWriteText: (text: string) => void (clipboardState.text = text),
    clipboardReadImage: () => clipboardState.image,
    clipboardWriteImage: (png: Uint8Array) => void (clipboardState.image = png),
    clipboardClear: () => {
      clipboardState.text = null
      clipboardState.image = null
    },
  }

  const BuildConfig = {
    getSync: () => ({
      ...buildState,
      isPackaged: buildState.buildEnvironment !== 'dev',
      runtime: {},
    }),
    get: async () => BuildConfig.getSync(),
  }

  const module = { Utils, BuildConfig }
  return { module, clipboardState, shellState, buildState }
}

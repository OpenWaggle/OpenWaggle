/**
 * electron-builder `files` exclusions for native prebuilds that can never load in the app being
 * packaged. onnxruntime-node, pi-tui, node-pty (including its bundled ConPTY) and
 * better-sqlite3 ship binaries for every platform and architecture and pick `<platform>-<arch>`
 * at runtime, so the others are dead weight. Linux also drops onnxruntime's CUDA and TensorRT
 * providers (about 370 MB), which the CPU-only embedding and voice pipelines never load.
 *
 * electron-builder expands `${arch}` per packaged architecture, so one macOS run that packages
 * arm64 and x64 keeps the right binary in each. `${platform}` is the host's `process.platform`:
 * every release and nightly build packages on its own OS (release.yml, nightly.yml), and a
 * cross-platform build would keep the host's prebuilds instead. These patterns sit in the
 * top-level `files` list: electron-builder copies a top-level `files` set apart from a platform
 * block's own `files`, so exclusions placed in `mac`, `win` or `linux` would not apply to it.
 * scripts/check-native-platform-floor.ts lists any foreign binary that still ships.
 */
const PLATFORM = '${platform}'
const ARCH = '${arch}'
const SELF_AND_CONTENTS = '{,/**/*}'
const ONNXRUNTIME_BIN = 'node_modules/**/onnxruntime-node/bin/napi-v6'
const PI_TUI_NATIVE = 'node_modules/**/@earendil-works/pi-tui/native'
const TARGET = `${PLATFORM}-${ARCH}`

const NODE_PTY_CONPTY = 'node_modules/**/node-pty/third_party/conpty'

/**
 * node-pty's bundled ConPTY is Windows-only, so a Windows pack keeps its own architecture and every
 * other pack drops it. Keyed on the host like `${platform}`.
 */
function conptyExclusion(hostPlatform: NodeJS.Platform) {
  return hostPlatform === 'win32'
    ? `!${NODE_PTY_CONPTY}/*/!(win10-${ARCH})${SELF_AND_CONTENTS}`
    : `!${NODE_PTY_CONPTY}${SELF_AND_CONTENTS}`
}

export function foreignNativePrebuildExclusions(hostPlatform: NodeJS.Platform = process.platform) {
  return [
    `!${ONNXRUNTIME_BIN}/!(${PLATFORM})${SELF_AND_CONTENTS}`,
    `!${ONNXRUNTIME_BIN}/${PLATFORM}/!(${ARCH})${SELF_AND_CONTENTS}`,
    `!${ONNXRUNTIME_BIN}/linux/*/libonnxruntime_providers_{cuda,tensorrt}.so`,
    `!${PI_TUI_NATIVE}/!(${PLATFORM})${SELF_AND_CONTENTS}`,
    `!${PI_TUI_NATIVE}/${PLATFORM}/prebuilds/!(${TARGET})${SELF_AND_CONTENTS}`,
    `!node_modules/**/node-pty/prebuilds/!(${TARGET})${SELF_AND_CONTENTS}`,
    conptyExclusion(hostPlatform),
    `!node_modules/**/better-sqlite3/prebuilds/!(${TARGET}.node)`,
  ]
}

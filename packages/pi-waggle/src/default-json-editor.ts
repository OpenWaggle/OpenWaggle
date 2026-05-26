import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import type { WaggleConfig, WagglePreset } from '@openwaggle/waggle-core'

const EDITOR_JSON_INDENT_SPACES = 2

export interface EditablePresetDraftJson {
  readonly name: string
  readonly description: string
  readonly config: WaggleConfig
}

export async function viewAdvancedJson(input: {
  readonly ctx: ExtensionCommandContext
  readonly title: string
  readonly value: EditablePresetDraftJson | WaggleConfig | WagglePreset
}) {
  if (!input.ctx.hasUI) return
  await input.ctx.ui.editor(
    input.title,
    `${JSON.stringify(input.value, null, EDITOR_JSON_INDENT_SPACES)}\n`,
  )
}

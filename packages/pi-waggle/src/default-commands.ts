import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import { parsePiWaggleCommandArgs } from './commands'
import { activatePreset, disableWaggle, notify, resolvePresetById } from './default-command-runtime'
import type { DefaultWaggleCommandInput } from './default-command-types'
import { editActiveConfig, editActiveMaxTurns } from './default-config-editors'
import { openWaggleControlCenter } from './default-control-center'
import { createPresetFromEditor, editPresetFromEditor } from './default-editors'
import { loadPiWagglePresetLayers, resolvedPresetsForUi } from './presets'

export async function handleDefaultWaggleCommand(
  input: DefaultWaggleCommandInput & { readonly args: string },
) {
  const intent = parsePiWaggleCommandArgs(input.args)
  if (intent.type === 'disable') return disableWaggle(input)
  if (intent.type === 'menu') return openWaggleControlCenter(input)
  if (intent.type === 'create-preset') return createPresetFromEditor({ ctx: input.ctx })
  if (intent.type === 'edit-preset') {
    return editPresetFromEditor({ ctx: input.ctx, presetId: intent.presetId })
  }
  if (intent.type === 'edit-config') return editActiveConfig({ pi: input.pi, ctx: input.ctx })
  if (intent.type === 'edit-turns') {
    return editActiveMaxTurns({ pi: input.pi, ctx: input.ctx, maxTurns: intent.maxTurns })
  }

  const resolved = await resolvePresetById(input.ctx.cwd, intent.presetId)
  if (resolved) {
    await activatePreset({ ...input, preset: resolved.preset, prompt: intent.prompt })
  } else {
    notify(input.ctx, `Unknown Waggle preset: ${intent.presetId}`, 'error')
  }
}

export async function defaultWaggleCommandCompletions(
  argumentPrefix: string,
  ctx?: ExtensionCommandContext,
) {
  const presets = resolvedPresetsForUi(await loadPiWagglePresetLayers(ctx?.cwd))

  return [
    { value: 'off', label: 'off', description: 'Disable Waggle mode' },
    {
      value: 'turns',
      label: 'turns',
      description: 'Advanced shortcut: set active Waggle max turns',
    },
    {
      value: 'config',
      label: 'config',
      description: 'Advanced shortcut: edit active Waggle configuration',
    },
    { value: 'new', label: 'new', description: 'Shortcut: create a custom Waggle preset' },
    {
      value: 'edit',
      label: 'edit',
      description: 'Advanced shortcut: edit an existing Waggle preset',
    },
    ...presets.map((preset) => ({
      value: preset.preset.id,
      label: preset.preset.name,
      description: preset.preset.description,
    })),
    ...presets.map((preset) => ({
      value: `edit ${preset.preset.id}`,
      label: `edit ${preset.preset.name}`,
      description: `Advanced shortcut: edit ${preset.preset.name}`,
    })),
  ].filter((completion) => completion.value.startsWith(argumentPrefix))
}

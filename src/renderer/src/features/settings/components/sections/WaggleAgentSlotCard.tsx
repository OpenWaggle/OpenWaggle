import type { ProviderInfo } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import {
  isInheritedWaggleModelBinding,
  WAGGLE_AGENT_COLORS,
  type WaggleAgentSlot,
} from '@shared/types/waggle'
import { ModelSelector } from '@/features/providers/components'
import { AGENT_BG, AGENT_BORDER } from '@/features/waggle/lib'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import type { WaggleFormAction } from '../../hooks/useWaggleForm'

const ROWS = 3

interface WaggleAgentSlotCardProps {
  index: 0 | 1
  agent: WaggleAgentSlot
  dispatchForm: (action: WaggleFormAction) => void
  dotLabel: string
  settings: Settings
  providerModels: ProviderInfo[]
}

export function WaggleAgentSlotCard({
  index,
  agent,
  dispatchForm,
  dotLabel,
  settings,
  providerModels,
}: WaggleAgentSlotCardProps) {
  const selectedAgentModel = isInheritedWaggleModelBinding(agent.model)
    ? settings.selectedModel
    : agent.model

  return (
    <div className={cn('rounded-lg border bg-[#111418] p-5 space-y-4', AGENT_BORDER[agent.color])}>
      <div className="flex items-center gap-2">
        <div className={cn('size-2.5 rounded-full', AGENT_BG[agent.color])} />
        <h3 className="text-sm font-medium text-text-secondary">Agent {dotLabel}</h3>
      </div>

      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Label</span>
        <TextInput
          type="text"
          value={agent.label}
          onChange={(e) => dispatchForm({ type: 'set-agent-label', index, label: e.target.value })}
          inputSize="sm"
          className="w-[200px] border-border focus:border-border-light"
        />
      </div>

      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Model</span>
        <ModelSelector
          value={selectedAgentModel}
          onChange={(model) => dispatchForm({ type: 'set-agent-model', index, model })}
          settings={settings}
          providerModels={providerModels}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-[13px] text-text-primary">Role description</span>
        <Textarea
          value={agent.roleDescription}
          onChange={(e) =>
            dispatchForm({ type: 'set-agent-role', index, roleDescription: e.target.value })
          }
          rows={ROWS}
          placeholder="Describe this agent's role and perspective..."
          resize="none"
          className="rounded-md border-border text-text-primary placeholder:text-text-tertiary"
        />
      </div>

      <div className="flex items-center justify-between h-[40px]">
        <span className="text-[13px] text-text-primary">Color</span>
        <div className="flex items-center gap-2">
          {WAGGLE_AGENT_COLORS.map((color) => (
            <Button
              variant="unstyled"
              key={color}
              type="button"
              onClick={() => dispatchForm({ type: 'set-agent-color', index, color })}
              className={cn(
                'size-6 rounded-full transition-all',
                AGENT_BG[color],
                agent.color === color
                  ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-[#111418]'
                  : 'opacity-50 hover:opacity-75',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

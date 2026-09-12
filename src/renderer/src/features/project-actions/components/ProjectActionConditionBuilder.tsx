import {
  formatProjectActionWhenExpression,
  type ProjectActionWhenNode,
  parseProjectActionWhenExpression,
} from '@shared/utils/project-action-shortcuts'
import { CircleX, Plus, TriangleAlert } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import {
  defaultProjectActionCondition,
  defaultProjectActionConditionGroup,
} from '../lib/project-action-condition-editor-model'
import { projectActionUnknownWhenVariables } from '../lib/project-action-model'
import { ProjectActionConditionNodeEditor } from './ProjectActionConditionNodeEditor'

interface ProjectActionConditionBuilderProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly expressionLabel?: string
}

/** A raw-compatible, visual editor for the exact condition grammar used at runtime. */
export function ProjectActionConditionBuilder({
  value,
  onChange,
  expressionLabel = 'When expression',
}: ProjectActionConditionBuilderProps) {
  const trimmed = value.trim()
  const parsed = trimmed.length === 0 ? undefined : parseProjectActionWhenExpression(trimmed)
  const invalid = trimmed.length > 0 && parsed === null
  const unknownVariables = invalid ? [] : projectActionUnknownWhenVariables(trimmed)

  function updateNode(node: ProjectActionWhenNode | undefined) {
    onChange(node === undefined ? '' : formatProjectActionWhenExpression(node))
  }

  function addRootCondition() {
    if (parsed === undefined || parsed === null) {
      updateNode(defaultProjectActionCondition())
      return
    }
    updateNode({ type: 'and', left: parsed, right: defaultProjectActionCondition() })
  }

  function addRootGroup() {
    const group = defaultProjectActionConditionGroup('or')
    if (parsed === undefined || parsed === null) {
      updateNode(group)
      return
    }
    updateNode({ type: 'and', left: parsed, right: group })
  }

  return (
    <div className="space-y-3" data-project-action-condition-builder>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-text-secondary">When</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" size="xs" onClick={addRootCondition}>
            <Plus className="size-3" />
            Condition
          </Button>
          <Button type="button" variant="secondary" size="xs" onClick={addRootGroup}>
            <Plus className="size-3" />
            Group
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        <TextInput
          inputSize="sm"
          monospace
          aria-label={expressionLabel}
          aria-invalid={invalid}
          value={value}
          placeholder="Always"
          onChange={(event) => onChange(event.currentTarget.value)}
          className={cn(invalid && 'border-error/70')}
        />
        {invalid ? (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-error-text">
            <CircleX className="size-3.5" />
            Use variables with !, &amp;&amp;, ||, and parentheses.
          </p>
        ) : null}
        {unknownVariables.length > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <TriangleAlert className="size-3.5" />
            Unknown context {unknownVariables.map((name) => `“${name}”`).join(', ')} evaluates to
            false unless the runtime provides it.
          </p>
        ) : null}
      </div>
      <div className="relative">
        {parsed === undefined ? (
          <div className="rounded-md border border-dashed border-border bg-bg px-3 py-3 text-xs text-text-muted">
            Always active. Add a condition or group to limit when this binding runs.
          </div>
        ) : parsed === null ? (
          <div className="rounded-md border border-error/30 bg-error/5 px-3 py-3 text-center text-xs text-error-text">
            Fix the expression above to continue editing visually.
          </div>
        ) : (
          <ProjectActionConditionNodeEditor
            node={parsed}
            onChange={updateNode}
            onRemove={() => updateNode(undefined)}
          />
        )}
      </div>
    </div>
  )
}

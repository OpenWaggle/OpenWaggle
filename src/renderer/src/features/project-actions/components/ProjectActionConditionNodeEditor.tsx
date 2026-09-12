import {
  formatProjectActionWhenExpression,
  type ProjectActionWhenNode,
} from '@shared/utils/project-action-shortcuts'
import { Minus, Plus, TriangleAlert } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import {
  booleanOperator,
  buildConditionGroup,
  type ConditionParts,
  defaultProjectActionCondition,
  defaultProjectActionConditionGroup,
  flattenConditionChildren,
  projectActionConditionParts,
  projectActionConditionRemoveLabel,
  setProjectActionConditionIdentifier,
  setProjectActionConditionNegated,
} from '../lib/project-action-condition-editor-model'
import {
  PROJECT_ACTION_WHEN_VARIABLES,
  projectActionUnknownWhenVariables,
} from '../lib/project-action-model'

interface ConditionNodeEditorProps {
  readonly node: ProjectActionWhenNode
  readonly depth?: number
  readonly onChange: (node: ProjectActionWhenNode) => void
  readonly onRemove?: () => void
}

function ConditionSelect(props: {
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const known = PROJECT_ACTION_WHEN_VARIABLES.some((option) => option === props.value)
  const options = known
    ? PROJECT_ACTION_WHEN_VARIABLES
    : [props.value, ...PROJECT_ACTION_WHEN_VARIABLES]
  return (
    <Select
      selectSize="xs"
      className="min-w-0 flex-1 font-mono"
      aria-label={`Condition variable ${props.value}`}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}

function RemoveNodeButton(props: {
  readonly label: string
  readonly onRemove: () => void
  readonly className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={props.label}
      aria-label={props.label}
      className={props.className}
      onClick={props.onRemove}
    >
      <Minus className="size-3" />
    </Button>
  )
}

function IdentifierConditionEditor(props: {
  readonly node: ProjectActionWhenNode
  readonly condition: ConditionParts
  readonly depth: number
  readonly onChange: (node: ProjectActionWhenNode) => void
  readonly onRemove?: () => void
}) {
  const unknown = projectActionUnknownWhenVariables(props.condition.identifier).length > 0
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-2">
      <Button
        type="button"
        variant={props.condition.negated ? 'accent' : 'secondary'}
        size="xs"
        aria-label={`Negate ${props.condition.identifier}`}
        aria-pressed={props.condition.negated}
        onClick={() =>
          props.onChange(setProjectActionConditionNegated(props.node, !props.condition.negated))
        }
      >
        Not
      </Button>
      <ConditionSelect
        value={props.condition.identifier}
        onChange={(identifier) =>
          props.onChange(setProjectActionConditionIdentifier(props.node, identifier))
        }
      />
      {unknown ? (
        <span
          role="img"
          className="inline-flex text-warning"
          title="Unknown contexts evaluate to false unless the runtime provides them."
          aria-label={`Unknown condition ${props.condition.identifier}`}
        >
          <TriangleAlert className="size-3.5" />
        </span>
      ) : null}
      {props.onRemove ? (
        <RemoveNodeButton
          label={projectActionConditionRemoveLabel(props.node, props.depth)}
          onRemove={props.onRemove}
        />
      ) : null}
    </div>
  )
}

function NegatedGroupEditor(
  props: Required<Pick<ConditionNodeEditorProps, 'node' | 'depth' | 'onChange'>> &
    Pick<ConditionNodeEditorProps, 'onRemove'>,
) {
  const node = props.node
  if (node.type !== 'not') return null
  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-secondary p-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="accent"
          size="xs"
          aria-label="Negate group"
          aria-pressed
          onClick={() => props.onChange(node.node)}
        >
          Not
        </Button>
        {props.onRemove ? (
          <RemoveNodeButton
            className="ml-auto"
            label={projectActionConditionRemoveLabel(node, props.depth)}
            onRemove={props.onRemove}
          />
        ) : null}
      </div>
      <div className="relative pl-4">
        <span className="absolute inset-y-0 left-1.5 w-px bg-border" aria-hidden />
        <span className="absolute left-1.5 top-4 h-px w-2.5 bg-border" aria-hidden />
        <ProjectActionConditionNodeEditor
          node={node.node}
          depth={props.depth + 1}
          onChange={(next) => props.onChange({ type: 'not', node: next })}
        />
      </div>
    </div>
  )
}

function childEntries(children: readonly ProjectActionWhenNode[]) {
  const counts = new Map<string, number>()
  return children.map((child) => {
    const expression = formatProjectActionWhenExpression(child)
    const count = counts.get(expression) ?? 0
    counts.set(expression, count + 1)
    return { child, key: `${expression}-${String(count)}` }
  })
}

function BooleanGroupEditor(
  props: Required<Pick<ConditionNodeEditorProps, 'node' | 'depth' | 'onChange'>> &
    Pick<ConditionNodeEditorProps, 'onRemove'>,
) {
  if (props.node.type !== 'and' && props.node.type !== 'or') return null
  const operator = props.node.type
  const children = flattenConditionChildren(props.node, operator)

  function updateChild(target: ProjectActionWhenNode, next: ProjectActionWhenNode) {
    let updated = false
    const nextChildren = children.map((child) => {
      if (updated || child !== target) return child
      updated = true
      return next
    })
    const nextNode = buildConditionGroup(nextChildren, operator)
    if (nextNode !== undefined) props.onChange(nextNode)
  }

  function removeChild(target: ProjectActionWhenNode) {
    let removed = false
    const nextChildren = children.filter((child) => {
      if (removed || child !== target) return true
      removed = true
      return false
    })
    props.onChange(buildConditionGroup(nextChildren, operator) ?? defaultProjectActionCondition())
  }

  function addChild(child: ProjectActionWhenNode) {
    const next = buildConditionGroup([...children, child], operator)
    if (next !== undefined) props.onChange(next)
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-secondary p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          selectSize="xs"
          aria-label="Condition group operator"
          value={operator}
          onChange={(event) => {
            const nextOperator = booleanOperator(event.currentTarget.value)
            if (nextOperator === null) return
            const next = buildConditionGroup(children, nextOperator)
            if (next !== undefined) props.onChange(next)
          }}
        >
          <option value="and">and</option>
          <option value="or">or</option>
        </Select>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={() => addChild(defaultProjectActionCondition())}
        >
          <Plus className="size-3" />
          Condition
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={() =>
            addChild(defaultProjectActionConditionGroup(operator === 'and' ? 'or' : 'and'))
          }
        >
          <Plus className="size-3" />
          Group
        </Button>
        {props.onRemove ? (
          <RemoveNodeButton
            className="ml-auto"
            label={projectActionConditionRemoveLabel(props.node, props.depth)}
            onRemove={props.onRemove}
          />
        ) : null}
      </div>
      <div className="space-y-2">
        {childEntries(children).map(({ child, key }) => (
          <div key={key} className="relative pl-4">
            <span className="absolute inset-y-0 left-1.5 w-px bg-border" aria-hidden />
            <span className="absolute left-1.5 top-4 h-px w-2.5 bg-border" aria-hidden />
            <ProjectActionConditionNodeEditor
              node={child}
              depth={props.depth + 1}
              onChange={(next) => updateChild(child, next)}
              onRemove={() => removeChild(child)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProjectActionConditionNodeEditor({
  node,
  depth = 0,
  onChange,
  onRemove,
}: ConditionNodeEditorProps) {
  const condition = projectActionConditionParts(node)
  if (condition !== null) {
    return (
      <IdentifierConditionEditor
        node={node}
        condition={condition}
        depth={depth}
        onChange={onChange}
        onRemove={onRemove}
      />
    )
  }
  if (node.type === 'not') {
    return <NegatedGroupEditor node={node} depth={depth} onChange={onChange} onRemove={onRemove} />
  }
  return <BooleanGroupEditor node={node} depth={depth} onChange={onChange} onRemove={onRemove} />
}

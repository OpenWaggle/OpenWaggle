import type { OrchestrationTaskStatus } from '@shared/types/orchestration'
import { GitBranch } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SubAgentCard } from './SubAgentCard'

export interface SubAgentTask {
  id: string
  title: string
  status: OrchestrationTaskStatus
  output?: string
  error?: string
}

interface SubAgentGroupProps {
  tasks: SubAgentTask[]
  isComplete: boolean
}

export function SubAgentGroup({ tasks, isComplete }: SubAgentGroupProps): React.JSX.Element {
  const completedCount = tasks.filter(
    (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
  ).length
  const totalCount = tasks.length

  return (
    <div className="rounded-lg border border-border-light bg-bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2 border-b border-border">
        <GitBranch className="h-3.5 w-3.5 text-accent shrink-0" />
        <span className="text-[13px] font-medium text-text-secondary">Sub-agents</span>
        <span
          className={cn(
            'ml-auto text-[12px]',
            isComplete ? 'text-text-muted' : 'text-text-tertiary',
          )}
        >
          {completedCount}/{totalCount} tasks
        </span>
      </div>

      {/* Task list */}
      <div className="px-3.5 py-2 space-y-0.5">
        {tasks.map((task) => (
          <SubAgentCard
            key={task.id}
            taskId={task.id}
            title={task.title}
            status={task.status}
            output={task.output}
            error={task.error}
          />
        ))}
      </div>
    </div>
  )
}

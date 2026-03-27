import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'

const ICON_SIZE = 12

interface SkillMentionChipProps {
  skillId: string
  skillName: string
}

export function SkillMentionChip({ skillId, skillName }: SkillMentionChipProps) {
  return (
    <span
      className={cn(
        'bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[13px]',
        'inline-flex items-center gap-1',
        'select-none cursor-default',
      )}
      title={`/${skillId}`}
    >
      <Sparkles size={ICON_SIZE} className="shrink-0" />
      <span className="truncate max-w-[200px]">{skillName}</span>
    </span>
  )
}

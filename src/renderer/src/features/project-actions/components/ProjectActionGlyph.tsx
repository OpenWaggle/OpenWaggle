import type { ProjectActionIcon } from '@shared/types/project-actions'
import { Bug, FlaskConical, Hammer, ListChecks, Play, Wrench } from 'lucide-react'

interface ProjectActionGlyphProps {
  readonly icon: ProjectActionIcon
  readonly className?: string
}

export function ProjectActionGlyph({ icon, className = 'size-3.5' }: ProjectActionGlyphProps) {
  if (icon === 'test') return <FlaskConical className={className} />
  if (icon === 'lint') return <ListChecks className={className} />
  if (icon === 'configure') return <Wrench className={className} />
  if (icon === 'build') return <Hammer className={className} />
  if (icon === 'debug') return <Bug className={className} />
  return <Play className={className} />
}

import { PROJECT_ACTION_ICONS, type ProjectActionIcon } from '@shared/types/project-actions'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { ProjectActionGlyph } from './ProjectActionGlyph'

const ICON_LABELS: Record<ProjectActionIcon, string> = {
  play: 'Play',
  test: 'Test',
  lint: 'Lint',
  configure: 'Configure',
  build: 'Build',
  debug: 'Debug',
}

interface ProjectActionIconPickerProps {
  readonly selected: ProjectActionIcon
  readonly onSelect: (icon: ProjectActionIcon) => void
}

export function ProjectActionIconPicker({ selected, onSelect }: ProjectActionIconPickerProps) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-text-secondary">Icon</legend>
      <div className="grid grid-cols-6 gap-1.5">
        {PROJECT_ACTION_ICONS.map((icon) => (
          <Button
            key={icon}
            type="button"
            variant="ghost"
            aria-label={`${ICON_LABELS[icon]} icon`}
            aria-pressed={selected === icon}
            onClick={() => onSelect(icon)}
            className={cn(
              'h-12 flex-col gap-1 border px-1 text-xs',
              selected === icon
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-border text-text-tertiary',
            )}
          >
            <ProjectActionGlyph icon={icon} className="size-4" />
            {ICON_LABELS[icon]}
          </Button>
        ))}
      </div>
    </fieldset>
  )
}

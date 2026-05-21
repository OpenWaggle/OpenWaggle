import { createFileRoute } from '@tanstack/react-router'
import { SkillsRouteSurface } from './-skills-route-surface'

export const Route = createFileRoute('/skills')({
  component: SkillsRouteSurface,
})

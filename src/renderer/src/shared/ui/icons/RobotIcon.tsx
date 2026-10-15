import type { ComponentPropsWithoutRef } from 'react'

/**
 * The outline robot from Tabler Icons (MIT, see THIRD_PARTY_NOTICES.md). Lucide's `bot` reads as a
 * chat bot; this one stands for a sub-agent doing work. It uses Lucide's stroke geometry.
 * It takes any SVG attribute, as a Lucide icon does.
 */
export function RobotIcon(props: ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" />
      <path d="M12 2v2" />
      <path d="M9 12v9" />
      <path d="M15 12v9" />
      <path d="M5 16l4 -2" />
      <path d="M15 14l4 2" />
      <path d="M9 18h6" />
      <path d="M10 8v.01" />
      <path d="M14 8v.01" />
    </svg>
  )
}

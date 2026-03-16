interface WaggleBeeIconProps {
  className?: string
}

/**
 * Minimal bee icon for sidebar thread status.
 * Stroke-based design (Lucide-compatible) readable at 14×14px.
 */
export function WaggleBeeIcon({ className }: WaggleBeeIconProps) {
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
      className={className}
    >
      {/* Head */}
      <circle cx="12" cy="7.5" r="2.5" />
      {/* Body */}
      <ellipse cx="12" cy="15.5" rx="4.5" ry="5.5" />
      {/* Stripes */}
      <line x1="7.8" y1="14" x2="16.2" y2="14" />
      <line x1="7.8" y1="17" x2="16.2" y2="17" />
      {/* Wings */}
      <path d="M8 11C5.5 8 6 4.5 8.5 5" />
      <path d="M16 11C18.5 8 18 4.5 15.5 5" />
    </svg>
  )
}

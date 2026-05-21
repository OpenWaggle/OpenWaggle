interface WaggleBeeIconProps {
  className?: string
}

/**
 * Bee icon for waggle mode indicators.
 * Uses filled shapes for readability at small sizes (14-16px).
 * The body has alternating filled/empty stripes and distinct wing shapes.
 */
export function WaggleBeeIcon({ className }: WaggleBeeIconProps) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Antennae */}
      <path d="M10 7.5C9 5.5 7.5 4.5 6 4" />
      <path d="M14 7.5C15 5.5 16.5 4.5 18 4" />
      {/* Head */}
      <circle cx="12" cy="9" r="2.5" fill="currentColor" />
      {/* Wings — larger teardrop shapes with visible fill */}
      <ellipse
        cx="6.5"
        cy="12"
        rx="4"
        ry="2.5"
        transform="rotate(-25 6.5 12)"
        fill="currentColor"
        opacity="0.5"
        stroke="currentColor"
        strokeWidth="0.5"
      />
      <ellipse
        cx="17.5"
        cy="12"
        rx="4"
        ry="2.5"
        transform="rotate(25 17.5 12)"
        fill="currentColor"
        opacity="0.5"
        stroke="currentColor"
        strokeWidth="0.5"
      />
      {/* Body — oval with stripes */}
      <ellipse cx="12" cy="16" rx="4" ry="5" />
      {/* Stripes — filled bands on the body */}
      <path d="M8.2 13.5h7.6" strokeWidth="2" />
      <path d="M8 16h8" strokeWidth="2" />
      <path d="M8.5 18.5h7" strokeWidth="2" />
      {/* Stinger */}
      <path d="M12 21v1.5" strokeWidth="1.5" />
    </svg>
  )
}

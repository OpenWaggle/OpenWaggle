declare module '*.svg?react' {
  import type * as React from 'react'
  const ReactComponent: React.ComponentType<React.SVGProps<SVGSVGElement>>
  export default ReactComponent
}

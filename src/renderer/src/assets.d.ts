declare module '*.css'

declare module '*.png' {
  const src: string
  export default src
}

declare module '*?worker&url' {
  const url: string
  export default url
}

declare module '*.svg' {
  const src: string
  export default src
}

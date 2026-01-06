declare module 'litegraph.js' {
  export const LiteGraph: any
  export class LGraph {
    configure(data: any): void
    clear(): void
    start(): void
    stop(): void
  }
  export class LGraphCanvas {
    constructor(canvas: string | HTMLCanvasElement, graph: LGraph)
    resize(width?: number, height?: number): void
    draw(force?: boolean, force_bg?: boolean): void
    setZoom(value: number, center?: [number, number]): void
    fitNodes(): void
    onNodeSelected?: (node: any) => void
    onNodeDeselected?: (node: any) => void
    ds: { offset: [number, number]; scale: number }
  }
  export class LGraphNode {}
}

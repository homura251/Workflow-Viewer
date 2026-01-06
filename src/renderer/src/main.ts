import { LGraph, LGraphCanvas, LGraphNode, LiteGraph } from 'litegraph.js'
import './style.css'

type WorkflowPayload =
  | { ok: true; sourcePath: string; workflow: unknown }
  | { ok: false; sourcePath?: string; error: string }

const statusEl = document.getElementById('status')!
const hintEl = document.getElementById('hint')!
const detailsEl = document.getElementById('details') as HTMLPreElement
const openBtn = document.getElementById('open-btn') as HTMLButtonElement
const dropTarget = document.getElementById('drop-target')!
const canvasEl = document.getElementById('graph-canvas') as HTMLCanvasElement

LiteGraph.NODE_DEFAULT_COLOR = '#2a2f3a'
LiteGraph.NODE_DEFAULT_BGCOLOR = '#141821'
LiteGraph.NODE_DEFAULT_BOXCOLOR = '#000'
LiteGraph.NODE_TITLE_COLOR = '#d6d9e0'
LiteGraph.DEFAULT_SHADOW_COLOR = 'rgba(0,0,0,0.35)'
LiteGraph.CANVAS_GRID_SIZE = 40
LiteGraph.link_type_colors = {
  MODEL: '#58a6ff',
  CLIP: '#a371f7',
  VAE: '#ff7b72',
  IMAGE: '#56d364',
  LATENT: '#d29922',
  CONDITIONING: '#f85149',
  MASK: '#79c0ff',
  INT: '#9cdcfe',
  FLOAT: '#b5cea8',
  STRING: '#ce9178',
  BOOLEAN: '#4ec9b0'
}

const graph = new LGraph()
const canvas = new LGraphCanvas(canvasEl, graph)
;(canvas as any).allow_dragcanvas = true
graph.start()

const PARAM_MAX_LINES = 10
const PARAM_MAX_VALUE_CHARS = 60

function setStatus(text: string) {
  statusEl.textContent = text
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ensureAllNodeTypes(workflow: any) {
  const nodes: any[] = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const types = new Set<string>()
  for (const node of nodes) {
    if (typeof node?.type === 'string') types.add(node.type)
  }

  for (const type of types) {
    if (LiteGraph.registered_node_types?.[type]) continue
    const title = type.split('/').at(-1) ?? type
    class UnknownNode extends (LGraphNode as any) {
      constructor() {
        super()
        this.title = title
        this.color = '#6b2b2b'
        this.bgcolor = '#221317'
      }
    }
    ;(UnknownNode as any).title = title
    ;(UnknownNode as any).desc = 'Unknown ComfyUI node (viewer fallback)'
    LiteGraph.registerNodeType(type, UnknownNode as any)
  }
}

function formatParamValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return value.length > PARAM_MAX_VALUE_CHARS ? `${value.slice(0, PARAM_MAX_VALUE_CHARS)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const json = JSON.stringify(value)
    if (!json) return String(value)
    return json.length > PARAM_MAX_VALUE_CHARS ? `${json.slice(0, PARAM_MAX_VALUE_CHARS)}…` : json
  } catch {
    return String(value)
  }
}

function buildViewerParams(node: any): Array<[string, string]> {
  const out: Array<[string, string]> = []

  const props = node?.properties
  if (props && typeof props === 'object') {
    const keys = Object.keys(props).sort((a, b) => a.localeCompare(b))
    for (const key of keys) out.push([key, formatParamValue(props[key])])
  }

  const widgetsValues = node?.widgets_values
  if (Array.isArray(widgetsValues)) {
    for (let i = 0; i < widgetsValues.length; i++) out.push([`w${i}`, formatParamValue(widgetsValues[i])])
  }

  return out.slice(0, PARAM_MAX_LINES)
}

function installParamOverlay(node: any) {
  if (!node || node.__viewerParamOverlayInstalled) return
  node.__viewerParamOverlayInstalled = true
  node.__viewerParams = buildViewerParams(node)

  const original = typeof node.onDrawForeground === 'function' ? node.onDrawForeground.bind(node) : null
  node.onDrawForeground = function (ctx: CanvasRenderingContext2D) {
    if (original) original(ctx)

    const params: Array<[string, string]> = this.__viewerParams ?? []
    if (!params.length) return

    const titleHeight = (LiteGraph as any).NODE_TITLE_HEIGHT ?? 24
    const paddingX = 8
    const lineHeight = 14
    const startX = paddingX
    let y = titleHeight + 8

    ctx.save()
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
    ctx.fillStyle = 'rgba(230,237,243,0.92)'

    for (const [key, value] of params) {
      const text = `${key}: ${value}`
      ctx.fillText(text, startX, y)
      y += lineHeight
    }

    ctx.restore()
  }

  const params = node.__viewerParams as Array<[string, string]>
  if (Array.isArray(node.size) && params.length) {
    const minHeight = ((LiteGraph as any).NODE_TITLE_HEIGHT ?? 24) + 8 + 14 * params.length + 12
    node.size[1] = Math.max(node.size[1] ?? 0, minHeight)
  }
}

function decorateGraphNodes() {
  const nodes: any[] = (graph as any)._nodes ?? []
  for (const node of nodes) installParamOverlay(node)
}

function fitToContent() {
  try {
    canvas.fitNodes()
  } catch {
    canvas.setZoom(1)
    canvas.ds.offset = [0, 0]
  }
  canvas.draw(true, true)
}

function showSelection(value: unknown) {
  detailsEl.textContent = value ? safeStringify(value) : '(none)'
}

canvas.onNodeSelected = (node: any) => {
  hintEl.classList.add('hidden')
  showSelection(node)
}

canvas.onNodeDeselected = () => showSelection(null)

async function loadWorkflowFromPath(sourcePath: string) {
  setStatus(`Loading: ${sourcePath}`)
  const payload = (await window.workflowViewer.readFile(sourcePath)) as WorkflowPayload
  if (!payload.ok) {
    setStatus(`Error: ${payload.error}`)
    return
  }

  const workflow = payload.workflow as any
  ensureAllNodeTypes(workflow)
  graph.clear()
  graph.configure(workflow)
  decorateGraphNodes()
  fitToContent()

  hintEl.classList.add('hidden')
  showSelection({ sourcePath: payload.sourcePath, summary: { nodes: workflow?.nodes?.length, links: workflow?.links?.length } })
  setStatus(`Loaded: ${payload.sourcePath}`)
}

openBtn.addEventListener('click', async () => {
  const path = await window.workflowViewer.openDialog()
  if (!path) return
  await loadWorkflowFromPath(path)
})

window.workflowViewer.onOpenPath(async (path) => {
  await loadWorkflowFromPath(path)
})

function acceptDragEvent(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
}

dropTarget.addEventListener('dragenter', acceptDragEvent)
dropTarget.addEventListener('dragover', (event) => {
  acceptDragEvent(event)
  dropTarget.classList.add('dragover')
})
dropTarget.addEventListener('dragleave', (event) => {
  acceptDragEvent(event)
  dropTarget.classList.remove('dragover')
})
dropTarget.addEventListener('drop', async (event) => {
  acceptDragEvent(event)
  dropTarget.classList.remove('dragover')
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  await loadWorkflowFromPath((file as any).path ?? file.name)
})

function resizeCanvasToContainer() {
  const rect = dropTarget.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const width = Math.max(1, Math.floor(rect.width * dpr))
  const height = Math.max(1, Math.floor(rect.height * dpr))
  canvas.resize(width, height)
  canvas.draw(true, true)
}

window.addEventListener('resize', resizeCanvasToContainer)
resizeCanvasToContainer()

let spaceDown = false
let panning = false
let panStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return
  spaceDown = true
  if ((event.target as HTMLElement | null)?.tagName !== 'INPUT' && (event.target as HTMLElement | null)?.tagName !== 'TEXTAREA') {
    event.preventDefault()
  }
})

window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return
  spaceDown = false
  panning = false
  panStart = null
})

canvasEl.addEventListener(
  'mousedown',
  (event) => {
    const shouldPan = event.button === 1 || (spaceDown && event.button === 0)
    if (!shouldPan) return
    panning = true
    panStart = { x: event.clientX, y: event.clientY, offsetX: canvas.ds.offset[0], offsetY: canvas.ds.offset[1] }
    canvasEl.style.cursor = 'grabbing'
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  true
)

window.addEventListener('mousemove', (event) => {
  if (!panning || !panStart) return
  const dx = event.clientX - panStart.x
  const dy = event.clientY - panStart.y
  canvas.ds.offset[0] = panStart.offsetX + dx
  canvas.ds.offset[1] = panStart.offsetY + dy
  canvas.draw(true, true)
})

window.addEventListener('mouseup', () => {
  if (!panning) return
  panning = false
  panStart = null
  canvasEl.style.cursor = ''
})

canvasEl.addEventListener('contextmenu', (event) => {
  if (panning) {
    event.preventDefault()
    event.stopPropagation()
  }
})

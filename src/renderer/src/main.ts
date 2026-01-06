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
})

window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return
  spaceDown = false
  panning = false
  panStart = null
})

canvasEl.addEventListener('mousedown', (event) => {
  if (!spaceDown || event.button !== 0) return
  panning = true
  panStart = { x: event.clientX, y: event.clientY, offsetX: canvas.ds.offset[0], offsetY: canvas.ds.offset[1] }
  canvasEl.style.cursor = 'grabbing'
  event.preventDefault()
  event.stopPropagation()
})

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

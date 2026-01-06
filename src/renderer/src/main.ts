import { LGraph, LGraphCanvas, LGraphNode, LiteGraph } from 'litegraph.js'
import './style.css'

type WorkflowPayload =
  | { ok: true; sourcePath: string; workflow: unknown }
  | { ok: false; sourcePath?: string; error: string }

type TabState = {
  id: string
  sourcePath: string
  title: string
  workflow: unknown
  view: { offset: [number, number]; scale: number } | null
}

const statusEl = document.getElementById('status')!
const hintEl = document.getElementById('hint')!
const detailsEl = document.getElementById('details') as HTMLPreElement
const openBtn = document.getElementById('open-btn') as HTMLButtonElement
const fitBtn = document.getElementById('fit-btn') as HTMLButtonElement
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn') as HTMLButtonElement
const tabsEl = document.getElementById('tabs')!
const dropTarget = document.getElementById('drop-target')!
const canvasEl = document.getElementById('graph-canvas') as HTMLCanvasElement
const mainLayoutEl = document.querySelector('.main') as HTMLElement

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
;(canvas as any).render_shadows = false
;(canvas as any).render_connections_shadows = false
;(canvas as any).connections_width = 3.5
graph.start()

const GROUP_DRAG_HANDLE_HEIGHT = 28
;(graph as any).getGroupOnPos = (x: number, y: number) => {
  const groups: any[] = (graph as any)._groups ?? []
  for (let i = groups.length - 1; i >= 0; i--) {
    const group = groups[i]
    if (!group?.isPointInside?.(x, y, 2, true)) continue
    const top = Array.isArray(group.pos) ? group.pos[1] : group.pos?.[1]
    if (typeof top === 'number' && y <= top + GROUP_DRAG_HANDLE_HEIGHT) return group
  }
  return null
}

let tabs: TabState[] = []
let activeTabId: string | null = null
let sidebarVisible = true

const PARAM_MAX_LINES = 10
const PARAM_MAX_VALUE_CHARS = 60
const ZOOM_STEP = 1.22
const ZOOM_WHEEL_INTENSITY = 60

function setStatus(text: string) {
  statusEl.textContent = text
}

function setSidebarVisible(nextVisible: boolean) {
  sidebarVisible = nextVisible
  mainLayoutEl.classList.toggle('sidebar-hidden', !sidebarVisible)
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
    ctx.font = '13px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
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

function toNodeDetails(node: any) {
  if (!node || typeof node !== 'object') return node
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    pos: node.pos,
    size: node.size,
    properties: node.properties,
    widgets_values: node.widgets_values,
    inputs: node.inputs,
    outputs: node.outputs
  }
}

function showActiveTabSummary() {
  const tab = getActiveTab()
  if (!tab) {
    showSelection(null)
    return
  }
  const workflow: any = tab.workflow
  showSelection({
    sourcePath: tab.sourcePath,
    summary: { nodes: workflow?.nodes?.length, links: workflow?.links?.length }
  })
}

canvas.onNodeSelected = (node: any) => {
  hintEl.classList.add('hidden')
  showSelection(toNodeDetails(node))
}

canvas.onNodeDeselected = () => showActiveTabSummary()

function pathToTitle(sourcePath: string) {
  const normalized = sourcePath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).at(-1) ?? sourcePath
}

function getActiveTab() {
  return tabs.find((t) => t.id === activeTabId) ?? null
}

function saveActiveTabView() {
  const tab = getActiveTab()
  if (!tab) return
  tab.view = { offset: [canvas.ds.offset[0], canvas.ds.offset[1]], scale: canvas.ds.scale }
}

function updateEmptyState() {
  const hasTabs = tabs.length > 0
  tabsEl.classList.toggle('hidden', !hasTabs)

  if (!hasTabs) {
    hintEl.classList.remove('hidden')
    showSelection(null)
    setStatus('Ready')
    graph.clear()
    canvas.draw(true, true)
  }
}

function renderTabs() {
  tabsEl.textContent = ''
  for (const tab of tabs) {
    const tabBtn = document.createElement('button')
    tabBtn.type = 'button'
    tabBtn.className = `tab${tab.id === activeTabId ? ' active' : ''}`
    tabBtn.title = tab.sourcePath
    tabBtn.addEventListener('click', () => activateTab(tab.id))

    const titleEl = document.createElement('span')
    titleEl.className = 'tab-title'
    titleEl.textContent = tab.title

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'tab-close'
    closeBtn.title = 'Close'
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      closeTab(tab.id)
    })

    tabBtn.append(titleEl, closeBtn)
    tabsEl.append(tabBtn)
  }
}

function loadWorkflowIntoGraph(workflow: unknown, { fit = false }: { fit?: boolean } = {}) {
  const wf = workflow as any
  ensureAllNodeTypes(wf)
  graph.clear()
  graph.configure(wf)
  decorateGraphNodes()
  if (fit) fitToContent()
  canvas.draw(true, true)
}

function activateTab(id: string) {
  if (activeTabId === id) return

  saveActiveTabView()
  activeTabId = id
  const tab = getActiveTab()
  renderTabs()

  if (!tab) {
    updateEmptyState()
    return
  }

  setStatus(`Loaded: ${tab.sourcePath}`)
  hintEl.classList.add('hidden')
  showActiveTabSummary()

  loadWorkflowIntoGraph(tab.workflow)
  if (tab.view) {
    canvas.ds.offset = [tab.view.offset[0], tab.view.offset[1]]
    canvas.ds.scale = tab.view.scale
    canvas.draw(true, true)
  } else {
    fitToContent()
    tab.view = { offset: [canvas.ds.offset[0], canvas.ds.offset[1]], scale: canvas.ds.scale }
  }
}

function closeTab(id: string) {
  const index = tabs.findIndex((t) => t.id === id)
  if (index < 0) return
  const wasActive = activeTabId === id

  tabs = tabs.filter((t) => t.id !== id)
  if (!tabs.length) {
    activeTabId = null
    renderTabs()
    updateEmptyState()
    return
  }

  if (wasActive) {
    const nextIndex = Math.min(index, tabs.length - 1)
    const nextId = tabs[nextIndex]!.id
    activeTabId = null
    renderTabs()
    activateTab(nextId)
    return
  }

  renderTabs()
}

function cycleTab(direction: 1 | -1) {
  if (!tabs.length) return
  const currentIndex = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + tabs.length) % tabs.length
  activateTab(tabs[nextIndex]!.id)
}

async function openWorkflowInNewTab(sourcePath: string) {
  const existing = tabs.find((t) => t.sourcePath === sourcePath)
  if (existing) {
    activateTab(existing.id)
    return
  }

  setStatus(`Loading: ${sourcePath}`)
  const payload = (await window.workflowViewer.readFile(sourcePath)) as WorkflowPayload
  if (!payload.ok) {
    setStatus(`Error: ${payload.error}`)
    return
  }

  const tab: TabState = {
    id: crypto.randomUUID(),
    sourcePath: payload.sourcePath,
    title: pathToTitle(payload.sourcePath),
    workflow: payload.workflow,
    view: null
  }

  tabs = [...tabs, tab]
  updateEmptyState()
  renderTabs()
  activateTab(tab.id)
}

openBtn.addEventListener('click', async () => {
  const path = await window.workflowViewer.openDialog()
  if (!path) return
  await openWorkflowInNewTab(path)
})

window.workflowViewer.onOpenPath(async (path) => {
  await openWorkflowInNewTab(path)
})

function acceptDragEvent(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function setDragOver(active: boolean) {
  dropTarget.classList.toggle('dragover', active)
}

async function handleDroppedFiles(files: FileList | null | undefined) {
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    await openWorkflowInNewTab((file as any).path ?? file.name)
  }
}

for (const el of [window, dropTarget] as const) {
  el.addEventListener('dragenter', (event: DragEvent) => {
    acceptDragEvent(event)
    setDragOver(true)
  })
  el.addEventListener('dragover', (event: DragEvent) => {
    acceptDragEvent(event)
    setDragOver(true)
  })
  el.addEventListener('dragleave', (event: DragEvent) => {
    acceptDragEvent(event)
    setDragOver(false)
  })
  el.addEventListener('drop', async (event: DragEvent) => {
    acceptDragEvent(event)
    setDragOver(false)
    await handleDroppedFiles(event.dataTransfer?.files)
  })
}

function resizeCanvasToContainer() {
  const rect = dropTarget.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  canvas.resize(width, height)
  canvas.draw(true, true)
}

window.addEventListener('resize', resizeCanvasToContainer)
resizeCanvasToContainer()

function zoomByFactor(factor: number, center?: { x: number; y: number }) {
  const nextScale = Math.min(4, Math.max(0.1, canvas.ds.scale * factor))
  const rect = dropTarget.getBoundingClientRect()
  const zoomCenter: [number, number] = center
    ? [center.x - rect.left, center.y - rect.top]
    : [rect.width / 2, rect.height / 2]
  ;(canvas.ds as any).changeScale(nextScale, zoomCenter)
  ;(graph as any).change?.()
  canvas.draw(true, true)
  saveActiveTabView()
}

function resetView() {
  canvas.setZoom(1)
  canvas.ds.offset = [0, 0]
  canvas.draw(true, true)
  saveActiveTabView()
}

// Trackpad-friendly zoom: LiteGraph uses wheelDeltaY/detail which can be missing on touchpads.
canvasEl.addEventListener(
  'wheel',
  (event) => {
    const dy = event.deltaY ?? 0
    if (!dy) return

    const factor = Math.pow(ZOOM_STEP, -dy / ZOOM_WHEEL_INTENSITY)
    zoomByFactor(factor, { x: event.clientX, y: event.clientY })

    event.preventDefault()
    event.stopImmediatePropagation()
  },
  { capture: true, passive: false }
)

let spaceDown = false
let panningPointerId: number | null = null
let panStart: { x: number; y: number; offsetX: number; offsetY: number } | null = null
let emptyClickCandidate: { pointerId: number; x: number; y: number } | null = null

function setCanvasCursor() {
  if (panningPointerId != null) canvasEl.style.cursor = 'grabbing'
  else if (spaceDown) canvasEl.style.cursor = 'grab'
  else canvasEl.style.cursor = ''
}

window.addEventListener('blur', () => {
  spaceDown = false
  panningPointerId = null
  panStart = null
  setCanvasCursor()
})

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return
  spaceDown = true
  setCanvasCursor()
  if ((event.target as HTMLElement | null)?.tagName !== 'INPUT' && (event.target as HTMLElement | null)?.tagName !== 'TEXTAREA') {
    event.preventDefault()
  }
})

window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return
  spaceDown = false
  if (panningPointerId == null) setCanvasCursor()
})

canvasEl.addEventListener(
  'pointerdown',
  (event) => {
    const shouldPan = event.button === 1 || (spaceDown && event.button === 0)
    if (!shouldPan) return

    panningPointerId = event.pointerId
    panStart = { x: event.clientX, y: event.clientY, offsetX: canvas.ds.offset[0], offsetY: canvas.ds.offset[1] }
    canvasEl.setPointerCapture(event.pointerId)
    setCanvasCursor()
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  true
)

canvasEl.addEventListener(
  'mousedown',
  (event) => {
    const shouldPan = event.button === 1 || (spaceDown && event.button === 0)
    if (!shouldPan) return
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  true
)

canvasEl.addEventListener(
  'pointermove',
  (event) => {
    if (panningPointerId == null || panStart == null) return
    if (event.pointerId !== panningPointerId) return
    const dx = event.clientX - panStart.x
    const dy = event.clientY - panStart.y
    canvas.ds.offset[0] = panStart.offsetX + dx / canvas.ds.scale
    canvas.ds.offset[1] = panStart.offsetY + dy / canvas.ds.scale
    canvas.draw(true, true)
    saveActiveTabView()
  },
  true
)

function isEmptySpaceClick(event: PointerEvent) {
  if (event.button !== 0) return false
  if (spaceDown) return false
  if (panningPointerId != null) return false

  const canvasAny = canvas as any
  const graphAny = graph as any
  if (typeof canvasAny.convertEventToCanvasOffset !== 'function') return false

  const pos: [number, number] = canvasAny.convertEventToCanvasOffset(event)
  const node = typeof graphAny.getNodeOnPos === 'function' ? graphAny.getNodeOnPos(pos[0], pos[1]) : null
  const group = typeof graphAny.getGroupOnPos === 'function' ? graphAny.getGroupOnPos(pos[0], pos[1]) : null
  return !node && !group
}

canvasEl.addEventListener(
  'pointerdown',
  (event) => {
    if (!isEmptySpaceClick(event)) return
    emptyClickCandidate = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  },
  true
)

canvasEl.addEventListener(
  'pointermove',
  (event) => {
    if (!emptyClickCandidate) return
    if (event.pointerId !== emptyClickCandidate.pointerId) return
    const dx = event.clientX - emptyClickCandidate.x
    const dy = event.clientY - emptyClickCandidate.y
    if (dx * dx + dy * dy > 9) emptyClickCandidate = null
  },
  true
)

canvasEl.addEventListener(
  'pointerup',
  (event) => {
    if (!emptyClickCandidate) return
    if (event.pointerId !== emptyClickCandidate.pointerId) return
    emptyClickCandidate = null

    ;(canvas as any).deselectAllNodes?.()
    ;(canvas as any).selected_group = null
    ;(canvas as any).setDirty?.(true, true)
    showActiveTabSummary()
    canvas.draw(true, true)
  },
  true
)

canvasEl.addEventListener(
  'pointerup',
  (event) => {
    if (panningPointerId == null) return
    if (event.pointerId !== panningPointerId) return
    panningPointerId = null
    panStart = null
    setCanvasCursor()
  },
  true
)

canvasEl.addEventListener(
  'pointercancel',
  (event) => {
    if (panningPointerId == null) return
    if (event.pointerId !== panningPointerId) return
    panningPointerId = null
    panStart = null
    setCanvasCursor()
  },
  true
)

canvasEl.addEventListener('contextmenu', (event) => {
  if (panningPointerId != null) {
    event.preventDefault()
    event.stopPropagation()
  }
})

fitBtn.addEventListener('click', () => {
  fitToContent()
  saveActiveTabView()
})

resetBtn.addEventListener('click', () => resetView())

toggleSidebarBtn.addEventListener('click', () => setSidebarVisible(!sidebarVisible))

window.workflowViewer.onCommand((command) => {
  if (command === 'zoom-in') zoomByFactor(ZOOM_STEP)
  else if (command === 'zoom-out') zoomByFactor(1 / ZOOM_STEP)
  else if (command === 'reset-view') resetView()
  else if (command === 'fit') {
    fitToContent()
    saveActiveTabView()
  } else if (command === 'toggle-sidebar') setSidebarVisible(!sidebarVisible)
  else if (command === 'close-tab') {
    if (activeTabId) closeTab(activeTabId)
  } else if (command === 'next-tab') cycleTab(1)
  else if (command === 'prev-tab') cycleTab(-1)
})

updateEmptyState()

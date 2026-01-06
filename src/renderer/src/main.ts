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

type ViewerParamItem = {
  label: string
  value: unknown
  kind: 'inline' | 'multiline'
}

const statusEl = document.getElementById('status')!
const hintEl = document.getElementById('hint')!
const paramsEl = document.getElementById('params') as HTMLPreElement
const detailsEl = document.getElementById('details') as HTMLPreElement
const openBtn = document.getElementById('open-btn') as HTMLButtonElement
const fitBtn = document.getElementById('fit-btn') as HTMLButtonElement
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn') as HTMLButtonElement
const copySelectionBtn = document.getElementById('copy-selection-btn') as HTMLButtonElement
const copyParamsBtn = document.getElementById('copy-params-btn') as HTMLButtonElement
const tabsEl = document.getElementById('tabs')!
const dropTarget = document.getElementById('drop-target')!
const canvasEl = document.getElementById('graph-canvas') as HTMLCanvasElement
const mainLayoutEl = document.querySelector('.main') as HTMLElement
const nodeOverlayEl = document.getElementById('node-overlay') as HTMLDivElement
const overlayMeasureCtx = document.createElement('canvas').getContext('2d')

type Rgb = { r: number; g: number; b: number }

const BASE_TYPE_COLORS: Record<string, string> = {
  MODEL: '#58a6ff',
  CLIP: '#a371f7',
  VAE: '#ff7b72',
  IMAGE: '#56d364',
  LATENT: '#d29922',
  CONDITIONING: '#f85149',
  MASK: '#79c0ff',
  CONTROL_NET: '#db6d28',
  INT: '#9cdcfe',
  FLOAT: '#b5cea8',
  STRING: '#ce9178',
  BOOLEAN: '#4ec9b0',
  ANY: '#c9d1d9'
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function parseHexColor(color: string): Rgb | null {
  const trimmed = color.trim()
  const match = /^#?([0-9a-f]{6})$/i.exec(trimmed)
  if (!match) return null
  const hex = match[1]!
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
}

function rgbToHex({ r, g, b }: Rgb) {
  const to2 = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

function dimHex(color: string, factor: number) {
  const rgb = parseHexColor(color)
  if (!rgb) return color
  return rgbToHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor })
}

function fnv1a32(input: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = h / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hh >= 0 && hh < 1) {
    r1 = c
    g1 = x
  } else if (hh >= 1 && hh < 2) {
    r1 = x
    g1 = c
  } else if (hh >= 2 && hh < 3) {
    g1 = c
    b1 = x
  } else if (hh >= 3 && hh < 4) {
    g1 = x
    b1 = c
  } else if (hh >= 4 && hh < 5) {
    r1 = x
    b1 = c
  } else {
    r1 = c
    b1 = x
  }
  const m = l - c / 2
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 }
}

function canonicalizeType(type: string) {
  const trimmed = type.trim()
  if (!trimmed) return trimmed
  if (/^[a-z0-9_]+$/i.test(trimmed)) return trimmed.toUpperCase()
  return trimmed
}

function stableTypeColor(type: string) {
  const canonical = canonicalizeType(type)
  const hit =
    BASE_TYPE_COLORS[canonical] ??
    BASE_TYPE_COLORS[canonical.toUpperCase()] ??
    BASE_TYPE_COLORS[canonical.toLowerCase()] ??
    BASE_TYPE_COLORS[type] ??
    BASE_TYPE_COLORS[type.toUpperCase()] ??
    BASE_TYPE_COLORS[type.toLowerCase()]
  if (hit) return hit

  const hash = fnv1a32(canonical)
  const hue = hash % 360
  const sat = 0.62
  const light = 0.55
  return rgbToHex(hslToRgb(hue, sat, light))
}

function ensureTypeColors(type: string) {
  const keys = new Set([type, canonicalizeType(type), type.toUpperCase(), type.toLowerCase()].filter(Boolean))
  const existing = Array.from(keys).find((key) => (LGraphCanvas as any).link_type_colors?.[key])
  const color = existing ? (LGraphCanvas as any).link_type_colors[existing] : stableTypeColor(type)

  for (const key of keys) {
    ;(LGraphCanvas as any).link_type_colors ??= {}
    ;(LGraphCanvas as any).link_type_colors[key] = color
    ;(canvas as any).default_connection_color_byType ??= {}
    ;(canvas as any).default_connection_color_byTypeOff ??= {}
    ;(canvas as any).default_connection_color_byType[key] = color
    ;(canvas as any).default_connection_color_byTypeOff[key] = dimHex(color, 0.35)
  }
}

function registerWorkflowTypeColors(workflow: any) {
  const nodes: any[] = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  for (const node of nodes) {
    const inputs: any[] = Array.isArray(node?.inputs) ? node.inputs : []
    const outputs: any[] = Array.isArray(node?.outputs) ? node.outputs : []
    for (const slot of [...inputs, ...outputs]) {
      if (!slot || typeof slot !== 'object') continue
      const type = slot.type
      if (typeof type !== 'string') continue
      ensureTypeColors(type)
    }
  }
}

LiteGraph.NODE_DEFAULT_COLOR = '#2a2f3a'
LiteGraph.NODE_DEFAULT_BGCOLOR = '#141821'
LiteGraph.NODE_DEFAULT_BOXCOLOR = '#000'
LiteGraph.NODE_TITLE_COLOR = '#d6d9e0'
LiteGraph.NODE_TEXT_COLOR = 'rgba(230, 237, 243, 0.92)'
LiteGraph.DEFAULT_SHADOW_COLOR = 'rgba(0,0,0,0.35)'
LiteGraph.CANVAS_GRID_SIZE = 40
LiteGraph.NODE_DEFAULT_SHAPE = 'card'

const graph = new LGraph()
const canvas = new LGraphCanvas(canvasEl, graph)
;(canvas as any).allow_dragcanvas = false
;(canvas as any).allow_dragnodes = false
;(canvas as any).render_shadows = false
;(canvas as any).render_connections_shadows = false
;(canvas as any).connections_width = 3.5
;(canvas as any).use_gradients = true
;(canvas as any).render_canvas_border = false
;(canvas as any).clear_background_color = '#0f121a'
;(canvas as any).title_text_font = '14px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
;(canvas as any).inner_text_font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
graph.start()

function getEffectiveDpr() {
  const raw = Number(window.devicePixelRatio || 1)
  if (!Number.isFinite(raw) || raw <= 0) return 1
  return Math.min(2, Math.max(1, raw))
}

function enableHiDpiCanvas(canvasInstance: LGraphCanvas) {
  const anyCanvas = canvasInstance as any
  if (anyCanvas.__viewerHiDpiInstalled) return
  anyCanvas.__viewerHiDpiInstalled = true

  const ds: any = canvasInstance.ds
  if (typeof ds.computeVisibleArea === 'function') {
    ds.computeVisibleArea = (viewport?: [number, number, number, number]) => {
      const dpr = Number(anyCanvas.__viewerDpr || 1)
      if (!ds.element) {
        ds.visible_area[0] = ds.visible_area[1] = ds.visible_area[2] = ds.visible_area[3] = 0
        return
      }

      const width = ds.element.width / dpr
      const height = ds.element.height / dpr
      const startx = -ds.offset[0] + (viewport ? viewport[0] / ds.scale : 0)
      const starty = -ds.offset[1] + (viewport ? viewport[1] / ds.scale : 0)
      const viewW = viewport ? viewport[2] : width
      const viewH = viewport ? viewport[3] : height
      const endx = startx + viewW / ds.scale
      const endy = starty + viewH / ds.scale
      ds.visible_area[0] = startx
      ds.visible_area[1] = starty
      ds.visible_area[2] = endx - startx
      ds.visible_area[3] = endy - starty
    }
  }

  ds.toCanvasContext = (ctx: CanvasRenderingContext2D) => {
    const dpr = Number(anyCanvas.__viewerDpr || 1)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.scale(ds.scale, ds.scale)
    ctx.translate(ds.offset[0], ds.offset[1])
  }
}

enableHiDpiCanvas(canvas)

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

const PARAM_MAX_LINES = 20
const PARAM_MAX_VALUE_CHARS = 60
const PARAM_FONT_SIZE = 13
const PARAM_LINE_HEIGHT = 16
const PARAM_WIDGET_HEIGHT = 20
const PARAM_PADDING_X = 10
const PARAM_TEXT_PADDING = 10
const PARAM_LABEL_OFFSET_Y = 16
const PARAM_TEXT_OFFSET_Y = 34
const PARAM_BOX_GAP = 6
const PARAM_MULTILINE_EXTRA = 28
const PARAM_FONT_FAMILY = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
const PARAM_FONT = `${PARAM_FONT_SIZE}px ${PARAM_FONT_FAMILY}`
const ZOOM_STEP = 1.22
const ZOOM_WHEEL_INTENSITY = 60
const MULTILINE_PREVIEW_LINES = 6

const COMFY_WIDGET_LABELS: Record<string, string[]> = {
  KSampler: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  CLIPTextEncode: ['text'],
  SaveImage: ['filename_prefix'],
  LoadImage: ['image', 'upload'],
  CheckpointLoaderSimple: ['ckpt_name'],
  DiffControlNetLoader: ['control_net_name'],
  ControlNetApply: ['strength'],
  VAEDecode: []
}

function shouldOmitWidgetParam(label: string, value: unknown) {
  const key = label.trim().toLowerCase()
  if (!key) return false

  // Common UI-only controls in ComfyUI widgets (not workflow params)
  if (key === 'upload') return true
  if (key === 'choose file') return true
  if (key === 'open') return true
  if (key === 'button') return true

  // Some nodes store a UI hint like "image" / "mask" in the upload slot.
  if (key === 'upload' && typeof value === 'string') return true

  return false
}

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

function formatParamValueForCopy(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    if (Number.isInteger(value)) return String(value)
    return value.toString()
  }
  if (typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copyText(text: string) {
  const trimmed = String(text ?? '')
  if (!trimmed) return false
  try {
    if (window.workflowViewer?.writeClipboardText) return await window.workflowViewer.writeClipboardText(trimmed)
  } catch {
    // ignore
  }
  try {
    await navigator.clipboard.writeText(trimmed)
    return true
  } catch {
    return false
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
    const accent = stableTypeColor(type)
    const titleColor = dimHex(accent, 0.65)
    class UnknownNode extends (LGraphNode as any) {
      constructor() {
        super()
        this.title = title
        this.color = titleColor
        this.bgcolor = '#151a24'
        this.boxcolor = 'rgba(255,255,255,0.08)'
      }
    }
    ;(UnknownNode as any).title = title
    ;(UnknownNode as any).desc = 'ComfyUI node (viewer stub type)'
    LiteGraph.registerNodeType(type, UnknownNode as any)
  }
}

function formatParamValue(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return value.length > PARAM_MAX_VALUE_CHARS ? `${value.slice(0, PARAM_MAX_VALUE_CHARS)}…` : value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    if (Number.isInteger(value)) return String(value)
    const trimmed = value.toFixed(4).replace(/\.?0+$/, '')
    return trimmed.length > PARAM_MAX_VALUE_CHARS ? `${trimmed.slice(0, PARAM_MAX_VALUE_CHARS)}…` : trimmed
  }
  if (typeof value === 'boolean') return String(value)
  try {
    const json = JSON.stringify(value)
    if (!json) return String(value)
    return json.length > PARAM_MAX_VALUE_CHARS ? `${json.slice(0, PARAM_MAX_VALUE_CHARS)}…` : json
  } catch {
    return String(value)
  }
}

function buildViewerParams(node: any): ViewerParamItem[] {
  const out: ViewerParamItem[] = []

  const props = node?.properties
  if (props && typeof props === 'object') {
    const keys = Object.keys(props).sort((a, b) => a.localeCompare(b))
    for (const key of keys) {
      if (key === 'Node name for S&R') continue
      out.push({ label: key, value: props[key], kind: 'inline' })
    }
  }

  const widgetsValues = node?.widgets_values
  if (Array.isArray(widgetsValues)) {
    const labels = COMFY_WIDGET_LABELS[String(node?.type ?? '')] ?? []
    for (let i = 0; i < widgetsValues.length; i++) {
      const label = labels[i] ?? `w${i}`
      const raw = widgetsValues[i]
      if (shouldOmitWidgetParam(label, raw)) continue
      const kind: ViewerParamItem['kind'] =
        label === 'text' || (typeof raw === 'string' && raw.includes('\n')) ? 'multiline' : 'inline'
      out.push({ label, value: raw, kind })
    }
  }

  return out
}

function normalizeNodeSize(node: any) {
  if (!node || Array.isArray(node.size)) return
  const size = node.size
  if (!size || typeof size !== 'object') return
  const w = (size as any)[0] ?? (size as any)['0']
  const h = (size as any)[1] ?? (size as any)['1']
  if (typeof w === 'number' && typeof h === 'number') node.size = [w, h]
}

function wrapTextByWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const paragraphs = normalized.split('\n')
  const lines: string[] = []

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('')
      continue
    }

    let current = ''
    for (const token of paragraph.split(/(\s+)/).filter((t) => t.length > 0)) {
      const next = current ? current + token : token
      if (ctx.measureText(next).width <= maxWidth) {
        current = next
        continue
      }

      if (current) {
        lines.push(current.trimEnd())
        current = ''
      }

      if (ctx.measureText(token).width <= maxWidth) {
        current = token
        continue
      }

      let chunk = ''
      for (const ch of token) {
        const attempt = chunk + ch
        if (ctx.measureText(attempt).width > maxWidth && chunk) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk = attempt
        }
      }
      current = chunk
    }
    if (current) lines.push(current.trimEnd())
  }

  return lines
}

type OverlayItemLayout = {
  kind: 'inline' | 'multiline'
  label: string
  value: string
  lines: string[]
  top: number
  height: number
}

type OverlayLayout = {
  startY: number
  boxWidth: number
  contentHeight: number
  items: OverlayItemLayout[]
}

function getOverlayParams(node: any) {
  if (!node || typeof node !== 'object') return [] as ViewerParamItem[]
  const cached = (node as any).__viewerParams
  if (Array.isArray(cached)) return cached as ViewerParamItem[]
  return buildViewerParams(node)
}

function buildOverlayLayout(node: any): OverlayLayout | null {
  if (!node || typeof node !== 'object') return null
  const params = getOverlayParams(node)
  if (!params.length) return null
  normalizeNodeSize(node)

  const slotHeight = (LiteGraph as any).NODE_SLOT_HEIGHT ?? 20
  const maxSlots = Math.max(Array.isArray(node.inputs) ? node.inputs.length : 0, Array.isArray(node.outputs) ? node.outputs.length : 0)
  const startY = Math.max(8, Math.ceil(maxSlots * slotHeight + 8))
  const boxWidth = Math.max(40, (node.size?.[0] ?? 0) - PARAM_PADDING_X * 2)

  if (overlayMeasureCtx) overlayMeasureCtx.font = PARAM_FONT

  let y = startY
  const items: OverlayItemLayout[] = []

  for (const item of params.slice(0, PARAM_MAX_LINES)) {
    const isMultiline = item.kind === 'multiline'
    const height =
      isMultiline
        ? PARAM_LINE_HEIGHT * MULTILINE_PREVIEW_LINES + PARAM_MULTILINE_EXTRA
        : PARAM_WIDGET_HEIGHT
    const value = isMultiline ? String(item.value ?? '') : formatParamValue(item.value)
    let lines: string[] = []

    if (isMultiline) {
      if (overlayMeasureCtx) {
        const maxTextWidth = Math.max(10, boxWidth - PARAM_TEXT_PADDING * 2)
        lines = wrapTextByWidth(overlayMeasureCtx, value, maxTextWidth).slice(0, MULTILINE_PREVIEW_LINES)
      } else {
        lines = value.split(/\r?\n/).slice(0, MULTILINE_PREVIEW_LINES)
      }
    }

    items.push({
      kind: item.kind,
      label: item.label,
      value,
      lines,
      top: y - startY,
      height
    })

    y += height + PARAM_BOX_GAP
  }

  const contentHeight = Math.max(0, y - startY - PARAM_BOX_GAP)
  return { startY, boxWidth, contentHeight, items }
}

function clearNodeOverlay() {
  nodeOverlayEl.textContent = ''
  overlayItems = []
  overlayLayout = null
}

function installOverlayInteractionHandlers(el: HTMLElement) {
  el.addEventListener('pointerdown', (event) => {
    overlayInteracting = true
    event.stopPropagation()
  })
  el.addEventListener('pointermove', (event) => event.stopPropagation())
  el.addEventListener('pointerup', (event) => {
    overlayInteracting = false
    event.stopPropagation()
  })
  el.addEventListener('pointercancel', (event) => {
    overlayInteracting = false
    event.stopPropagation()
  })
}

function renderNodeOverlay(node: any) {
  clearNodeOverlay()
  const layout = buildOverlayLayout(node)
  if (!layout) return false
  overlayLayout = layout
  nodeOverlayEl.style.width = `${layout.boxWidth}px`
  nodeOverlayEl.style.height = `${Math.max(0, layout.contentHeight)}px`

  if (overlayMeasureCtx) overlayMeasureCtx.font = PARAM_FONT
  const measuredAscent = overlayMeasureCtx?.measureText('Mg')?.actualBoundingBoxAscent
  const fontAscent = typeof measuredAscent === 'number' && measuredAscent > 0 ? measuredAscent : PARAM_FONT_SIZE
  const inlineTextTop = PARAM_WIDGET_HEIGHT * 0.7 - fontAscent
  const multilineLabelTop = PARAM_LABEL_OFFSET_Y - fontAscent

  for (const item of layout.items) {
    const itemEl = document.createElement('div')
    itemEl.className = `node-overlay-item ${item.kind}`
    itemEl.style.top = `${item.top}px`
    itemEl.style.height = `${item.height}px`
    itemEl.style.width = `${layout.boxWidth}px`

    const labelEl = document.createElement('span')
    labelEl.className = 'node-overlay-label'
    labelEl.textContent = item.label
    labelEl.style.left = `${PARAM_TEXT_PADDING}px`
    labelEl.style.top = `${item.kind === 'inline' ? inlineTextTop : multilineLabelTop}px`
    itemEl.append(labelEl)

    if (item.kind === 'multiline') {
      for (let i = 0; i < item.lines.length; i++) {
        const lineEl = document.createElement('span')
        lineEl.className = 'node-overlay-multiline-line'
        lineEl.textContent = item.lines[i] ?? ''
        lineEl.style.left = `${PARAM_TEXT_PADDING}px`
        lineEl.style.right = `${PARAM_TEXT_PADDING}px`
        lineEl.style.top = `${PARAM_TEXT_OFFSET_Y + i * PARAM_LINE_HEIGHT - fontAscent}px`
        itemEl.append(lineEl)
      }
    } else {
      const valueEl = document.createElement('span')
      valueEl.className = 'node-overlay-value'
      valueEl.textContent = item.value
      valueEl.style.top = `${inlineTextTop}px`
      valueEl.style.right = `${PARAM_TEXT_PADDING}px`
      itemEl.append(valueEl)
    }

    installOverlayInteractionHandlers(itemEl)
    nodeOverlayEl.append(itemEl)
    overlayItems.push(itemEl)
  }

  return layout.items.length > 0
}

function installParamOverlay(node: any) {
  if (!node || node.__viewerParamOverlayInstalled) return
  node.__viewerParamOverlayInstalled = true
  normalizeNodeSize(node)
  node.__viewerParams = buildViewerParams(node)

  const original = typeof node.onDrawForeground === 'function' ? node.onDrawForeground.bind(node) : null
  node.onDrawForeground = function (ctx: CanvasRenderingContext2D) {
    if (original) original(ctx)

    const params: ViewerParamItem[] = this.__viewerParams ?? []
    if (!params.length) return
    const suppressText = nodeOverlayVisible && selectedNode === this

    const titleHeight = (LiteGraph as any).NODE_TITLE_HEIGHT ?? 24
    const slotHeight = (LiteGraph as any).NODE_SLOT_HEIGHT ?? 20
    const maxSlots = Math.max(Array.isArray(this.inputs) ? this.inputs.length : 0, Array.isArray(this.outputs) ? this.outputs.length : 0)
    const startY = Math.max(8, Math.ceil(maxSlots * slotHeight + 8))
    const startX = PARAM_PADDING_X
    let y = startY

    ctx.save()
    ctx.font = PARAM_FONT
    const boxWidth = Math.max(40, (this.size?.[0] ?? 0) - PARAM_PADDING_X * 2)

    for (const item of params.slice(0, PARAM_MAX_LINES)) {
      const label = item.label
      const rawText = item.kind === 'multiline' ? String(item.value ?? '') : formatParamValue(item.value)

      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.lineWidth = 1

      const boxHeight =
        item.kind === 'multiline'
          ? PARAM_LINE_HEIGHT * MULTILINE_PREVIEW_LINES + PARAM_MULTILINE_EXTRA
          : PARAM_WIDGET_HEIGHT
      const rx = startX
      const ry = y
      const rw = boxWidth
      const rh = boxHeight
      ctx.beginPath()
      if (typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(rx, ry, rw, rh, 10)
      else ctx.rect(rx, ry, rw, rh)
      ctx.fill()
      ctx.stroke()

      if (item.kind === 'multiline') {
        if (!suppressText) {
          ctx.fillStyle = 'rgba(180,190,205,0.92)'
          ctx.fillText(label, startX + PARAM_TEXT_PADDING, y + PARAM_LABEL_OFFSET_Y)

          ctx.fillStyle = 'rgba(230,237,243,0.92)'
          const textY = y + PARAM_TEXT_OFFSET_Y
          const maxTextWidth = Math.max(10, boxWidth - PARAM_TEXT_PADDING * 2)
          const wrapped = wrapTextByWidth(ctx, rawText, maxTextWidth).slice(0, MULTILINE_PREVIEW_LINES)
          for (let i = 0; i < wrapped.length; i++)
            ctx.fillText(wrapped[i]!, startX + PARAM_TEXT_PADDING, textY + i * PARAM_LINE_HEIGHT)
        }
      } else {
        if (!suppressText) {
          const baselineY = y + PARAM_WIDGET_HEIGHT * 0.7
          ctx.fillStyle = 'rgba(180,190,205,0.92)'
          ctx.fillText(label, startX + PARAM_TEXT_PADDING, baselineY)

          ctx.fillStyle = 'rgba(230,237,243,0.92)'
          ctx.textAlign = 'right'
          ctx.fillText(String(rawText), startX + boxWidth - PARAM_TEXT_PADDING, baselineY)
          ctx.textAlign = 'left'
        }
      }

      y += boxHeight + PARAM_BOX_GAP
    }

    ctx.restore()
  }

  const params = node.__viewerParams as ViewerParamItem[]
  if (Array.isArray(node.size) && params.length) {
    const slotHeight = (LiteGraph as any).NODE_SLOT_HEIGHT ?? 20
    const maxSlots = Math.max(Array.isArray(node.inputs) ? node.inputs.length : 0, Array.isArray(node.outputs) ? node.outputs.length : 0)
    let needed = Math.max(0, Math.ceil(maxSlots * slotHeight + 8)) + 12
    for (const item of params.slice(0, PARAM_MAX_LINES)) {
      needed +=
        (item.kind === 'multiline'
          ? PARAM_LINE_HEIGHT * MULTILINE_PREVIEW_LINES + PARAM_MULTILINE_EXTRA
          : PARAM_WIDGET_HEIGHT) + PARAM_BOX_GAP
    }
    node.size[1] = Math.max(node.size[1] ?? 0, needed)
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

function showParamsText(text: string) {
  paramsEl.textContent = text ? text : '(none)'
}

let selectedNode: any | null = null
let nodeOverlayVisible = false
let overlaySyncRunning = false
let overlayInteracting = false
let overlayLayout: OverlayLayout | null = null
let overlayItems: HTMLDivElement[] = []
let lastOverlayLayout: { left: number; top: number; width: number; height: number; scale: number } | null = null

function setNodeOverlayVisible(visible: boolean) {
  nodeOverlayVisible = visible
  nodeOverlayEl.classList.toggle('hidden', !visible)
  nodeOverlayEl.setAttribute('aria-hidden', visible ? 'false' : 'true')
  if (visible) startOverlaySync()
  else stopOverlaySync()
  try {
    ;(canvas as any).setDirty?.(true, true)
    canvas.draw(true, true)
  } catch {
    // ignore
  }
}

function computeOverlayLayout(node: any) {
  if (!node || !overlayLayout || !isVec2(node.pos)) return null
  const scale = canvas.ds.scale
  const left = (node.pos[0] + PARAM_PADDING_X + canvas.ds.offset[0]) * scale
  const top = (node.pos[1] + overlayLayout.startY + canvas.ds.offset[1]) * scale
  return { left, top, width: overlayLayout.boxWidth, height: overlayLayout.contentHeight, scale }
}

function updateNodeOverlay() {
  if (!nodeOverlayVisible || !selectedNode || !overlayLayout) return
  if (overlayInteracting) return
  const layout = computeOverlayLayout(selectedNode)
  if (!layout) return

  const prev = lastOverlayLayout
  const changed =
    !prev ||
    Math.abs(prev.left - layout.left) > 0.5 ||
    Math.abs(prev.top - layout.top) > 0.5 ||
    Math.abs(prev.scale - layout.scale) > 0.0001 ||
    Math.abs(prev.width - layout.width) > 0.5 ||
    Math.abs(prev.height - layout.height) > 0.5
  if (!changed) return
  lastOverlayLayout = layout

  nodeOverlayEl.style.left = `${layout.left}px`
  nodeOverlayEl.style.top = `${layout.top}px`
  nodeOverlayEl.style.width = `${layout.width}px`
  nodeOverlayEl.style.height = `${layout.height}px`
  nodeOverlayEl.style.transform = `scale(${layout.scale})`
}

function startOverlaySync() {
  if (overlaySyncRunning) return
  overlaySyncRunning = true
  const tick = () => {
    if (!overlaySyncRunning) return
    updateNodeOverlay()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function stopOverlaySync() {
  overlaySyncRunning = false
  lastOverlayLayout = null
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
    selectedNode = null
    copyParamsBtn.disabled = true
    showParamsText('')
    clearNodeOverlay()
    setNodeOverlayVisible(false)
    return
  }
  const workflow: any = tab.workflow
  showSelection({
    sourcePath: tab.sourcePath,
    summary: { nodes: workflow?.nodes?.length, links: workflow?.links?.length }
  })
  selectedNode = null
  copyParamsBtn.disabled = true
  showParamsText('')
  clearNodeOverlay()
  setNodeOverlayVisible(false)
}

canvas.onNodeSelected = (node: any) => {
  hintEl.classList.add('hidden')
  showSelection(toNodeDetails(node))
  selectedNode = node
  copyParamsBtn.disabled = false
  const text = nodeParamsToText(node)
  showParamsText(text)
  const overlayReady = renderNodeOverlay(node)
  setNodeOverlayVisible(overlayReady)
  updateNodeOverlay()
}

canvas.onNodeDeselected = () => showActiveTabSummary()

function nodeParamsToText(node: any) {
  if (!node || typeof node !== 'object') return ''
  const params = Array.isArray((node as any).__viewerParams) ? ((node as any).__viewerParams as ViewerParamItem[]) : buildViewerParams(node)
  if (!params.length) return ''
  return params
    .map((item) => {
      const value = item.kind === 'multiline' ? String(item.value ?? '') : formatParamValueForCopy(item.value)
      if (item.kind === 'multiline') return value ? `${item.label}\n${value}` : item.label
      return `${item.label}\t${value}`
    })
    .join('\n')
}

copySelectionBtn.addEventListener('click', async () => {
  const ok = await copyText(detailsEl.textContent ?? '')
  if (ok) setStatus('Copied JSON')
})

copyParamsBtn.addEventListener('click', async () => {
  const text = selectedNode ? nodeParamsToText(selectedNode) : ''
  const ok = await copyText(text)
  if (ok) setStatus('Copied params')
})

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
  registerWorkflowTypeColors(wf)
  for (const type of Object.keys(BASE_TYPE_COLORS)) ensureTypeColors(type)
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
  ;(canvas as any).__viewerDpr = getEffectiveDpr()
  canvas.resize(Math.max(1, Math.floor(width * (canvas as any).__viewerDpr)), Math.max(1, Math.floor(height * (canvas as any).__viewerDpr)))
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
let emptyClickCandidate: { pointerId: number; x: number; y: number } | null = null

const DRAG_THRESHOLD_SQ = 9

type ActiveDrag =
  | { mode: 'pan'; pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number }
  | { mode: 'node'; pointerId: number; startX: number; startY: number; nodes: Array<{ node: any; x: number; y: number }> }

type DragCandidate = { mode: 'pan' | 'node'; pointerId: number; startX: number; startY: number } | null

let dragCandidate: DragCandidate = null
let activeDrag: ActiveDrag | null = null

function isVec2(value: any): value is { 0: number; 1: number } {
  return Boolean(value && typeof value[0] === 'number' && typeof value[1] === 'number')
}

function getNodeUnderPointer(event: PointerEvent) {
  const canvasAny = canvas as any
  const graphAny = graph as any
  if (typeof canvasAny.convertEventToCanvasOffset !== 'function') return null
  const pos: [number, number] = canvasAny.convertEventToCanvasOffset(event)
  return typeof graphAny.getNodeOnPos === 'function' ? graphAny.getNodeOnPos(pos[0], pos[1]) : null
}

function getGroupUnderPointer(event: PointerEvent) {
  const canvasAny = canvas as any
  const graphAny = graph as any
  if (typeof canvasAny.convertEventToCanvasOffset !== 'function') return null
  const pos: [number, number] = canvasAny.convertEventToCanvasOffset(event)
  return typeof graphAny.getGroupOnPos === 'function' ? graphAny.getGroupOnPos(pos[0], pos[1]) : null
}

function isNodeSelected(node: any) {
  return Boolean(node && (canvas as any).selected_nodes && (canvas as any).selected_nodes[node.id])
}

function isInNodeTitleBar(node: any, event: PointerEvent) {
  if (!node || !isVec2(node.pos) || !isVec2(node.size)) return false
  const canvasAny = canvas as any
  if (typeof canvasAny.convertEventToCanvasOffset !== 'function') return false
  const pos: [number, number] = canvasAny.convertEventToCanvasOffset(event)
  const titleHeight = (LiteGraph as any).NODE_TITLE_HEIGHT ?? 30
  const x = pos[0]
  const y = pos[1]
  return x >= node.pos[0] && x <= node.pos[0] + node.size[0] && y >= node.pos[1] - titleHeight && y <= node.pos[1]
}

function beginPan(pointerId: number, startX: number, startY: number) {
  activeDrag = { mode: 'pan', pointerId, startX, startY, offsetX: canvas.ds.offset[0], offsetY: canvas.ds.offset[1] }
  setCanvasCursor()
}

function beginNodeDrag(pointerId: number, startX: number, startY: number) {
  const selectedMap: Record<string, any> = ((canvas as any).selected_nodes ?? {}) as any
  const nodes = Object.values(selectedMap).filter(Boolean)
  if (!nodes.length) {
    beginPan(pointerId, startX, startY)
    return
  }
  activeDrag = {
    mode: 'node',
    pointerId,
    startX,
    startY,
    nodes: nodes.map((node: any) => ({ node, x: isVec2(node?.pos) ? node.pos[0] : 0, y: isVec2(node?.pos) ? node.pos[1] : 0 }))
  }
  setCanvasCursor()
}

function setCanvasCursor() {
  if (activeDrag?.mode === 'pan') canvasEl.style.cursor = 'grabbing'
  else if (activeDrag?.mode === 'node') canvasEl.style.cursor = 'move'
  else if (spaceDown) canvasEl.style.cursor = 'grab'
  else canvasEl.style.cursor = ''
}

window.addEventListener('blur', () => {
  spaceDown = false
  dragCandidate = null
  activeDrag = null
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
  if (!activeDrag) setCanvasCursor()
})

canvasEl.addEventListener(
  'pointerdown',
  (event) => {
    const shouldPan = event.button === 1 || (spaceDown && event.button === 0)
    if (!shouldPan) return

    dragCandidate = null
    beginPan(event.pointerId, event.clientX, event.clientY)
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
    if (!activeDrag) return
    if (event.pointerId !== activeDrag.pointerId) return

    const dx = event.clientX - activeDrag.startX
    const dy = event.clientY - activeDrag.startY

    if (activeDrag.mode === 'pan') {
      canvas.ds.offset[0] = activeDrag.offsetX + dx / canvas.ds.scale
      canvas.ds.offset[1] = activeDrag.offsetY + dy / canvas.ds.scale
      canvas.draw(true, true)
      saveActiveTabView()
    } else {
      for (const item of activeDrag.nodes) {
        const node = item.node
        if (!node?.pos) node.pos = [item.x, item.y]
        node.pos[0] = item.x + dx / canvas.ds.scale
        node.pos[1] = item.y + dy / canvas.ds.scale
      }
      ;(graph as any).change?.()
      canvas.draw(true, true)
    }

    event.preventDefault()
    event.stopImmediatePropagation()
  },
  true
)

// LMB drag behavior:
// - Drag node(s) only when the node is already selected and the drag starts from its title bar
// - Dragging empty space pans the canvas
// - Dragging on node body does not pan (so it won't fight with text overlay)
canvasEl.addEventListener(
  'pointerdown',
  (event) => {
    if (event.button !== 0) return
    if (spaceDown) return
    if (activeDrag) return

    const node = getNodeUnderPointer(event)
    const group = node ? null : getGroupUnderPointer(event)
    const mode: 'pan' | 'node' | null =
      node && isNodeSelected(node) && isInNodeTitleBar(node, event) ? 'node' : !node && !group ? 'pan' : null
    dragCandidate = mode ? { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY } : null
  },
  true
)

canvasEl.addEventListener(
  'pointermove',
  (event) => {
    if (!dragCandidate) return
    if (event.pointerId !== dragCandidate.pointerId) return
    if (activeDrag) return

    const dx = event.clientX - dragCandidate.startX
    const dy = event.clientY - dragCandidate.startY
    if (dx * dx + dy * dy <= DRAG_THRESHOLD_SQ) return

    if (overlayInteracting) return

    if (dragCandidate.mode === 'node') beginNodeDrag(event.pointerId, dragCandidate.startX, dragCandidate.startY)
    else beginPan(event.pointerId, dragCandidate.startX, dragCandidate.startY)

    canvasEl.setPointerCapture(event.pointerId)
    dragCandidate = null
    emptyClickCandidate = null
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  true
)

function isEmptySpaceClick(event: PointerEvent) {
  if (event.button !== 0) return false
  if (spaceDown) return false
  if (activeDrag?.mode === 'pan') return false

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
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      activeDrag = null
      dragCandidate = null
      setCanvasCursor()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (dragCandidate && event.pointerId === dragCandidate.pointerId) dragCandidate = null
  },
  true
)

canvasEl.addEventListener(
  'pointercancel',
  (event) => {
    if (activeDrag && event.pointerId === activeDrag.pointerId) {
      activeDrag = null
      dragCandidate = null
      setCanvasCursor()
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    if (dragCandidate && event.pointerId === dragCandidate.pointerId) dragCandidate = null
  },
  true
)

canvasEl.addEventListener('contextmenu', (event) => {
  if (activeDrag?.mode === 'pan') {
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

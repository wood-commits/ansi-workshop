import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { ANSI_COLORS, BLOCK_GLYPHS, CP437 } from './ansi'
import { contains, type Cell, type Editor, key, MAX_ROW, type Point, type Rect, WIDTH } from './model'
import type { GradientLine } from './gradient'
import { drawVgaGlyph, type CanvasFont } from './vgaFont'
import { TOOL_CURSORS, type Tool } from './tools'

const GUTTER = 42
const VIEWPORT_CHROME_HEIGHT = 25
export const CANVAS_SIZES = [
  { id: 'native', label: 'Pixel perfect (8×16)', width: 8, height: 16 },
  { id: 'classic', label: '1.25× (10×20)', width: 10, height: 20 },
  { id: 'double', label: '2× (16×32)', width: 16, height: 32 },
] as const
const shadePatterns = new WeakMap<CanvasRenderingContext2D, Map<CanvasRenderingContext2D['fillStyle'], Map<number, CanvasPattern>>>()

const connections = new Map<string, [number, number, number, number]>([
  ['│', [1, 0, 1, 0]], ['─', [0, 1, 0, 1]], ['┌', [0, 1, 1, 0]], ['┐', [0, 0, 1, 1]],
  ['└', [1, 1, 0, 0]], ['┘', [1, 0, 0, 1]], ['├', [1, 1, 1, 0]], ['┤', [1, 0, 1, 1]],
  ['┬', [0, 1, 1, 1]], ['┴', [1, 1, 0, 1]], ['┼', [1, 1, 1, 1]],
  ['║', [2, 0, 2, 0]], ['═', [0, 2, 0, 2]], ['╔', [0, 2, 2, 0]], ['╗', [0, 0, 2, 2]],
  ['╚', [2, 2, 0, 0]], ['╝', [2, 0, 0, 2]], ['╠', [2, 2, 2, 0]], ['╣', [2, 0, 2, 2]],
  ['╦', [0, 2, 2, 2]], ['╩', [2, 2, 0, 2]], ['╬', [2, 2, 2, 2]],
])

export function drawGlyph(ctx: CanvasRenderingContext2D, code: number, x: number, y: number, w: number, h: number, font: CanvasFont = 'consolas'): void {
  if (font === 'ibm-vga') { drawVgaGlyph(ctx, code, x, y, w, h); return }
  if (code === 32 || code === 255) return
  const block = BLOCK_GLYPHS.get(code)
  if (block) {
    const [left, top, width, height] = block
    ctx.fillRect(x + left * w, y + top * h, width * w, height * h)
    return
  }
  if (code >= 176 && code <= 178) {
    const color = ctx.fillStyle
    let colors = shadePatterns.get(ctx)
    if (!colors) { colors = new Map(); shadePatterns.set(ctx, colors) }
    let patterns = colors.get(color)
    if (!patterns) { patterns = new Map(); colors.set(color, patterns) }
    let pattern = patterns.get(code)
    if (!pattern) {
      const tile = document.createElement('canvas')
      tile.width = 4; tile.height = 2
      const tileContext = tile.getContext('2d')
      if (!tileContext) throw new Error('Unable to create the shading raster.')
      tileContext.fillStyle = color
      for (let py = 0; py < 2; py++) for (let px = 0; px < 4; px++) {
        const light = (px + (py % 2) * 2) % 4 === 0
        if ((code === 176 && light) || (code === 177 && (px + py) % 2 === 0) || (code === 178 && !light)) {
          tileContext.fillRect(px, py, 1, 1)
        }
      }
      const created = ctx.createPattern(tile, 'repeat')
      if (!created) throw new Error('Unable to create the shading pattern.')
      pattern = created
      patterns.set(code, pattern)
    }
    // Patterns anchor to the raster origin, preserving phase across cell boundaries.
    ctx.fillStyle = pattern
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = color
    return
  }
  const lines = connections.get(CP437[code])
  if (lines) {
    const cx = x + w / 2, cy = y + h / 2
    const stroke = w / 8
    for (let direction = 0; direction < 4; direction++) {
      const weight = lines[direction]
      for (const offset of weight === 2 ? [-w / 8, w / 8] : weight === 1 ? [0] : []) {
        if (direction === 0) ctx.fillRect(cx + offset - stroke / 2, y, stroke, h / 2 + stroke / 2)
        if (direction === 1) ctx.fillRect(cx - stroke / 2, cy + offset - stroke / 2, w / 2 + stroke / 2, stroke)
        if (direction === 2) ctx.fillRect(cx + offset - stroke / 2, cy - stroke / 2, stroke, h / 2 + stroke / 2)
        if (direction === 3) ctx.fillRect(x, cy + offset - stroke / 2, w / 2 + stroke / 2, stroke)
      }
    }
    return
  }
  ctx.font = `${h * 0.84}px "Consolas", "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(CP437[code], x + w / 2, y + h * 0.79, w)
}

export function ShadeGlyph({ code, color, width = 16, height = 32, font = 'ibm-vga' }: {
  code: number
  color: string
  width?: number
  height?: number
  font?: CanvasFont
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = color
    drawGlyph(ctx, code, 0, 0, width, height, font)
  }, [code, color, width, height, font])
  return <canvas ref={canvas} className="shade-glyph" width={width} height={height} aria-hidden="true" />
}

interface CanvasProps {
  editor: Editor
  tool: Tool
  revision: number
  cursor: Point
  top: number
  selection: Rect | undefined
  selecting: boolean
  navigating: boolean
  cellSize?: typeof CANVAS_SIZES[number]
  font?: CanvasFont
  primitive?: boolean
  halfBlock?: boolean
  singleClick?: boolean
  overlay?: ReadonlyMap<string, Cell>
  gradientLine?: GradientLine
  onNavigate(point: Point): void
  onPoint(point: Point, start: boolean, pointer: PointerInput): void
  onEnd(canceled: boolean): void
  onScroll(delta: number): void
  onKey(event: React.KeyboardEvent<HTMLCanvasElement>): void
  onRows(rows: number): void
}

export interface PointerInput { clientX: number; altKey: boolean; half: 0 | 1 }

function useCanvasPointer(canvas: RefObject<HTMLCanvasElement | null>, {
  top, rows, cellWidth, gutter, selecting, navigating, primitive, halfBlock, singleClick, onNavigate, onPoint, onEnd, onScroll, onKey,
}: Pick<CanvasProps, 'top' | 'selecting' | 'onPoint' | 'onScroll' | 'onKey'> & {
  primitive?: boolean
  halfBlock?: boolean
  singleClick?: boolean
  navigating?: boolean
  onNavigate?(point: Point): void
  rows: number
  cellWidth: number
  gutter: number
  onEnd(point: Point, moved: boolean, canceled: boolean): void
}) {
  const [dragging, setDragging] = useState(false)
  const dragPointer = useRef<{
    clientX: number; clientY: number; pointerId: number; altKey: boolean; half: 0 | 1
    start: Point; point: Point; moved: boolean
  } | undefined>(undefined)
  const bounds = () => {
    const element = canvas.current
    if (!element) return undefined
    const rect = element.getBoundingClientRect()
    const left = rect.left + element.clientLeft, top = rect.top + element.clientTop
    const width = rect.width - (element.offsetWidth - element.clientWidth)
    const height = rect.height - (element.offsetHeight - element.clientHeight)
    if (width <= 0 || height <= 0) return undefined
    return { left, top, width, height, bottom: top + height }
  }
  const pointAt = (position: Pick<PointerEvent, 'clientX' | 'clientY'>, start: boolean, viewportTop = top) => {
    const rect = bounds()
    if (!rect) return undefined
    let x = Math.floor(((position.clientX - rect.left) / rect.width * (gutter + WIDTH * cellWidth) - gutter) / cellWidth)
    const fractionalRow = (position.clientY - rect.top) / rect.height * rows
    let row = Math.floor(fractionalRow)
    if ((selecting || primitive) && !start) {
      x = Math.min(WIDTH - 1, Math.max(0, x))
      row = Math.min(rows - 1, Math.max(0, row))
    } else if (x < 0 || x >= WIDTH || row < 0 || row >= rows) return undefined
    const half: 0 | 1 = fractionalRow - Math.floor(fractionalRow) < 0.5 ? 0 : 1
    return { point: { x, y: Math.min(MAX_ROW, viewportTop + row) }, half }
  }
  const updatePointer = (viewportTop = top) => {
    const position = dragPointer.current
    if (!position) return
    const hit = pointAt(position, false, viewportTop)
    if (!hit) return
    const { point, half } = hit
    position.point = point
    position.half = half
    position.moved ||= point.x !== position.start.x || point.y !== position.start.y
    onPoint(point, false, position)
  }
  const finish = (canceled = false) => {
    const position = dragPointer.current
    if (!position) return
    dragPointer.current = undefined
    setDragging(false)
    if (canvas.current?.hasPointerCapture?.(position.pointerId)) canvas.current.releasePointerCapture(position.pointerId)
    onEnd(position.point, position.moved, canceled)
  }
  const scrollSelection = useEffectEvent(() => {
    const position = dragPointer.current
    const rect = bounds()
    if (!position || !rect || !selecting) return
    const distance = position.clientY < rect.top ? position.clientY - rect.top
      : position.clientY >= rect.bottom ? Math.max(1, position.clientY - rect.bottom) : 0
    if (!distance) return
    const delta = Math.sign(distance) * Math.min(10, Math.ceil(Math.abs(distance) / (rect.height / rows)))
    const nextTop = Math.min(MAX_ROW, Math.max(0, top + delta))
    if (nextTop === top) return
    onScroll(nextTop - top)
    updatePointer(nextTop)
  })
  const cancelDrag = useEffectEvent(() => finish(true))
  useEffect(() => {
    if (!dragging) return
    const blur = () => cancelDrag()
    window.addEventListener('blur', blur)
    const timer = selecting ? window.setInterval(scrollSelection, 50) : undefined
    return () => {
      window.removeEventListener('blur', blur)
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [dragging, selecting])

  return {
    onKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>) { if (event.key === 'Escape') finish(true); onKey(event) },
    onBlur: () => finish(true),
    onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
      if (event.button !== 0 || dragPointer.current) return
      const hit = pointAt(event, true)
      if (!hit) return
      const { point, half } = hit
      const pointer = { clientX: event.clientX, altKey: event.altKey, half }
      event.currentTarget.focus({ preventScroll: true })
      if (onNavigate && (navigating || event.altKey)) {
        event.preventDefault()
        onNavigate(point)
        return
      }
      if (singleClick) {
        event.preventDefault()
        onPoint(point, true, pointer)
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      dragPointer.current = {
        clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, altKey: event.altKey, half,
        start: point, point, moved: false,
      }
      setDragging(true)
      onPoint(point, true, pointer)
    },
    onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
      const position = dragPointer.current
      if (!position || event.pointerId !== position.pointerId) return
      position.clientX = event.clientX
      position.clientY = event.clientY
      position.altKey = event.altKey
      updatePointer()
    },
    onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
      const position = dragPointer.current
      if (!position || event.pointerId !== position.pointerId) return
      if ((primitive || halfBlock) && (position.clientX !== event.clientX || position.clientY !== event.clientY)) {
        position.clientX = event.clientX; position.clientY = event.clientY; position.altKey = event.altKey
        updatePointer()
      }
      finish()
    },
    onPointerCancel: () => finish(true),
    onLostPointerCapture: () => finish(true),
  }
}

function drawGradientLine(ctx: CanvasRenderingContext2D, line: GradientLine, top: number, w: number, h: number, gutter: number) {
  const x = gutter + (line.start.x + 0.5) * w, y = (line.start.y - top + 0.5) * h
  const endX = gutter + (line.end.x + 0.5) * w, endY = (line.end.y - top + 0.5) * h
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, y); ctx.lineTo(endX, endY)
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.stroke()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeRect(x - 3, y - 3, 6, 6)
  ctx.strokeRect(endX - 3, endY - 3, 6, 6)
  ctx.restore()
}

function useCanvasRenderer(canvas: RefObject<HTMLCanvasElement | null>, {
  editor, revision, cursor, top, selection, overlay, gradientLine, font,
  rows, cellWidth, cellHeight, gutter,
}: Pick<CanvasProps, 'editor' | 'revision' | 'cursor' | 'top' | 'selection' | 'overlay' | 'gradientLine' | 'font'> & {
  rows: number; cellWidth: number; cellHeight: number; gutter: number
}) {
  const raster = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!canvas.current?.getContext('2d')) return
    const image = raster.current ?? document.createElement('canvas')
    raster.current = image
    const width = gutter + WIDTH * cellWidth, height = rows * cellHeight
    if (image.width !== width) image.width = width
    if (image.height !== height) image.height = height
    const ctx = image.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    if (gutter) {
      ctx.fillStyle = '#121821'
      ctx.fillRect(0, 0, gutter, height)
    }
    for (let row = 0; row < rows; row++) {
      const y = top + row
      if (gutter) {
        ctx.fillStyle = '#657184'
        ctx.font = '10px monospace'
        ctx.textAlign = 'right'
        ctx.fillText(String(y + 1), gutter - 6, row * cellHeight + 14, gutter - 8)
      }
      for (let x = 0; x < WIDTH; x++) {
        const cell = overlay?.get(key(x, y)) ?? editor.cell({ x, y })
        const dx = gutter + x * cellWidth, dy = row * cellHeight
        ctx.fillStyle = ANSI_COLORS[cell.bg]
        ctx.fillRect(dx, dy, cellWidth, cellHeight)
        ctx.fillStyle = ANSI_COLORS[cell.fg]
        drawGlyph(ctx, cell.code, dx, dy, cellWidth, cellHeight, font)
        if (selection && contains(selection, { x, y })) {
          ctx.fillStyle = '#61ddff44'
          ctx.fillRect(dx, dy, cellWidth, cellHeight)
        }
      }
    }
  }, [canvas, editor, revision, top, rows, selection, overlay, cellWidth, cellHeight, gutter, font])
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx || !raster.current) return
    ctx.drawImage(raster.current, 0, 0)
    if (cursor.y >= top && cursor.y < top + rows) {
      const x = gutter + cursor.x * cellWidth, y = (cursor.y - top) * cellHeight
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 3
      ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2)
    }
    if (gradientLine) drawGradientLine(ctx, gradientLine, top, cellWidth, cellHeight, gutter)
  }, [canvas, editor, revision, cursor, top, rows, selection, overlay, gradientLine, cellWidth, cellHeight, gutter, font])
}

function RowScrollbar({ top, rows, maximum, canvasId, disabled, onScroll }: {
  top: number
  rows: number
  maximum: number
  canvasId: string
  disabled: boolean
  onScroll(delta: number): void
}) {
  const [dragMaximum, setDragMaximum] = useState<number>()
  const drag = useRef<{ pointerId: number; clientY: number; top: number; travel: number; maximum: number } | undefined>(undefined)
  const max = dragMaximum ?? maximum
  const thumbHeight = rows / (max + rows) * 100
  const finish = () => { drag.current = undefined; setDragMaximum(undefined) }
  const cancel = useEffectEvent(finish)
  useEffect(() => {
    if (dragMaximum === undefined) return
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [dragMaximum])
  const moveThumb = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || event.pointerId !== start.pointerId || disabled) return
    const next = Math.round(Math.min(start.maximum, Math.max(0,
      start.top + (event.clientY - start.clientY) / start.travel * start.maximum,
    )))
    onScroll(next - top)
  }

  return <div className="row-scrollbar" role="scrollbar" aria-label="Canvas rows"
    aria-orientation="vertical" aria-controls={canvasId} aria-valuemin={0}
    aria-valuemax={max} aria-valuenow={top} aria-valuetext={`Top row ${top + 1}`}
    aria-disabled={disabled} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || disabled || drag.current) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      const bounds = event.currentTarget.getBoundingClientRect()
      const height = Math.min(bounds.height, Math.max(28, bounds.height * rows / (max + rows)))
      const travel = bounds.height - height
      if (travel <= 0) return
      if (event.target === event.currentTarget) {
        const thumbTop = top / max * travel
        onScroll(event.clientY - bounds.top < thumbTop ? -rows : rows)
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { pointerId: event.pointerId, clientY: event.clientY, top, travel, maximum: max }
      setDragMaximum(max)
    }}
    onPointerMove={moveThumb}
    onPointerUp={event => {
      if (!drag.current || event.pointerId !== drag.current.pointerId) return
      moveThumb(event)
      finish()
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}
    onPointerCancel={finish} onLostPointerCapture={finish} onBlur={finish}
    onKeyDown={event => {
      if (event.key === 'Escape') { finish(); return }
      if (disabled || drag.current) return
      const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1
        : event.key === 'PageUp' ? -rows : event.key === 'PageDown' ? rows
        : event.key === 'Home' ? -top : event.key === 'End' ? max - top : undefined
      if (delta === undefined) return
      event.preventDefault()
      onScroll(Math.min(max, Math.max(0, top + delta)) - top)
    }}>
    <div className="row-scrollbar-thumb" aria-hidden="true" style={{
      height: `max(28px, ${thumbHeight}%)`,
      top: `calc(${top / max * 100}% - max(28px, ${thumbHeight}%) * ${top / max})`,
    }} />
  </div>
}

export function ArtCanvas({ editor, tool, revision, cursor, top, selection, selecting, navigating, cellSize = CANVAS_SIZES[0], font = 'ibm-vga', primitive, halfBlock, singleClick, overlay, gradientLine, onNavigate, onPoint, onEnd, onScroll, onKey, onRows }: CanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const canvasId = useId()
  const extent = useMemo(() => ({ revision, lastRow: editor.lastRow }), [editor, revision])
  const [rows, setRows] = useState(25)
  const [scrollbarHeight, setScrollbarHeight] = useState(0)
  const { width: cellWidth, height: cellHeight } = cellSize
  const pointerHandlers = useCanvasPointer(canvas, {
    top, rows, cellWidth, gutter: GUTTER, selecting, navigating, primitive, halfBlock, singleClick, onNavigate, onPoint,
    onEnd: (_point, _moved, canceled) => onEnd(canceled), onScroll, onKey,
  })
  const resizeRows = useEffectEvent((next: number) => {
    if (cursor.y >= top && cursor.y < top + rows && cursor.y >= top + next) onScroll(cursor.y - top - next + 1)
    setRows(next)
    onRows(next)
  })
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setScrollbarHeight(element.offsetHeight - element.clientHeight)
      const next = Math.max(5, Math.floor((entry.contentRect.height - VIEWPORT_CHROME_HEIGHT) / cellHeight))
      resizeRows(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [cellHeight])
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return
      event.preventDefault()
      if (primitive && overlay) return
      onScroll(Math.sign(event.deltaY) * (event.deltaMode === 2 ? rows : 3))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [onScroll, rows, primitive, overlay])
  useCanvasRenderer(canvas, {
    editor, revision, cursor, top, selection, overlay, gradientLine, font,
    rows, cellWidth, cellHeight, gutter: GUTTER,
  })

  const viewportStyle: CSSProperties & { '--scrollbar-height': string } = { '--scrollbar-height': `${scrollbarHeight}px` }
  return <div className="canvas-viewport" style={viewportStyle}>
    <div ref={host} className="canvas-host" style={{
    ...{ '--cell-height': `${cellHeight}px`, '--scrollbar-height': `${scrollbarHeight}px` },
    minHeight: cellSize.id === 'double' ? 25 * cellHeight + VIEWPORT_CHROME_HEIGHT + scrollbarHeight : undefined,
  }}>
    <div className="column-ruler" aria-hidden="true" style={{ width: GUTTER + WIDTH * cellWidth + 1 }}>
      <span style={{ width: GUTTER }}>COL</span>{Array.from({ length: 8 }, (_, i) =>
        <span key={i} style={{ width: 10 * cellWidth }}>{String(i * 10 + 1).padStart(2, '0')}</span>)}
    </div>
    <canvas ref={canvas} id={canvasId} width={GUTTER + WIDTH * cellWidth} height={rows * cellHeight}
      data-navigating={navigating} data-font={font} style={{ cursor: TOOL_CURSORS[tool] }}
      tabIndex={0} aria-label={`ANSI canvas, cursor column ${cursor.x + 1}, row ${cursor.y + 1}`}
      {...pointerHandlers}
    />
    </div>
    <RowScrollbar top={top} rows={rows} canvasId={canvasId}
      maximum={Math.min(MAX_ROW, Math.max(extent.lastRow, top) + rows * 3)}
      disabled={!!(primitive && overlay)} onScroll={onScroll} />
  </div>
}

type PreviewProps = Pick<CanvasProps, 'editor' | 'revision' | 'cursor' | 'top' | 'selection' | 'onPoint' | 'onScroll' | 'onKey' | 'overlay' | 'gradientLine' | 'font'> & {
  onEnd(point: Point, moved: boolean): void
}

export function VgaPreview({ editor, revision, cursor, top, selection, onPoint, onEnd, onScroll, onKey, overlay, gradientLine, font = 'ibm-vga' }: PreviewProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pointerHandlers = useCanvasPointer(canvas, {
    top, rows: 60, cellWidth: 8, gutter: 0, selecting: true, onPoint, onEnd, onScroll, onKey,
  })
  useCanvasRenderer(canvas, {
    editor, revision, cursor, top, selection, overlay, gradientLine, font,
    rows: 60, cellWidth: 8, cellHeight: 16, gutter: 0,
  })
  return <section className="panel preview-panel" aria-label="VGA preview">
    <div className="panel-heading"><h2>VGA preview</h2><span className="badge">8:16</span></div>
    <canvas ref={canvas} width={640} height={960} tabIndex={0}
      data-font={font}
      aria-label={`Live VGA preview, rows ${top + 1} through ${top + 60}`} {...pointerHandlers} />
    <p>Live proportions · rows {top + 1}–{top + 60}</p>
    <p>Click to move · drag to select · canvas shortcuts available</p>
  </section>
}

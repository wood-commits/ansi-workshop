import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ANSI_COLORS, BACKGROUND_COLORS, COLOR_NAMES, CP437, PALETTES, characterCode } from './ansi'
import { colorCss, colorName, type DocumentFormat } from './colors'
import { TundraColors } from './TundraColors'
import { readTundraDocument } from './tundra'
import { ArtCanvas, CANVAS_SIZES, ShadeGlyph, VgaPreview, type PointerInput } from './Canvas'
import type { Tool } from './tools'
import type { CanvasFont } from './vgaFont'
import { Editor, EMPTY, MAX_ROW, WIDTH, linePoints, pointFromKey, rectangle, validPoint, type Block, type Cell, type Point } from './model'
import { rasterizePrimitive, subtractPrimitive, type PrimitiveKind } from './primitives'
import { convertPathNode, rasterizePath, removePathNode, type BezierPath, type PathNode } from './path'
import { gradientRegion, rasterizeGradient, type GradientKind, type GradientLine } from './gradient'
import { bucketFill, type FillMode } from './fill'
import { connectedShape, moveShape } from './move'
import { rasterizeHalfBlockStroke, type HalfPoint } from './draw'
import { chooseFile, hasNativeSave, writeAnsi, writeAscii, writeTundra, type AnsiFileHandle } from './save'
import { chooseAnsiFile } from './open'
import { readAnsiDocument } from './import'
import { SauceDialog } from './SauceDialog'
import { AgentPanel } from './AgentPanel'
import { AnsimationPanel } from './AnsimationPanel'
import { captureFrame, type AnimationFrame } from './ansimation'
import { executeAgentCommand } from './agentCommands'
import fontLicense from './assets/fonts/LICENSE.txt?raw'
import fontNotice from './assets/fonts/NOTICE.txt?raw'
import editorLicense from '../LICENSE?raw'
import { version } from '../package.json'

const RELEASE_VERSION = version.split('.').slice(0, 2).join('.')

const TOOL_ICONS = {
  draw: <path d="m16 3 5 5L8 21H3v-5ZM14 5l5 5" />,
  cursor: <path d="m4 3 16 10-8 1-4 7Z" />,
  erase: <path d="m4 14 10-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3L11 21H8l-4-4a2 2 0 0 1 0-3ZM9 9l8 8M11 21h10" />,
  recolor: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 3v18M6 6h3v3H6ZM15 15h3v3h-3Z" /></>,
  select: <rect x="4" y="4" width="16" height="16" rx="1" strokeDasharray="3 3" />,
  move: <path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  primitive: <><rect x="3" y="3" width="10" height="10" rx="1" /><circle cx="16" cy="16" r="5" /></>,
  path: <><path d="M4 19C6 3 17 3 20 16M4 19l3-12M20 16l-2-9" /><rect x="2" y="17" width="4" height="4" /><rect x="18" y="14" width="4" height="4" /><circle cx="7" cy="7" r="2" /><circle cx="18" cy="7" r="2" /></>,
  gradient: <>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M6 7v10" strokeOpacity=".2" /><path d="M9 7v10" strokeOpacity=".4" />
    <path d="M12 7v10" strokeOpacity=".6" /><path d="M15 7v10" strokeOpacity=".8" /><path d="M18 7v10" />
  </>,
  fill: <path d="m4 10 7-7 9 9-7 7ZM7 3l7 7M4 10h14M3 22h12M21 15s-2 2-2 3a2 2 0 0 0 4 0c0-1-2-3-2-3Z" />,
  eyedropper: <path d="m14 3 7 7M16 5l2-2a2 2 0 0 1 3 3l-2 2M16 7 4 19l-1 3 4-1L19 10M6 17l3 3" />,
}

function ToolIcon({ tool }: { tool: Tool }) {
  return <svg className="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {TOOL_ICONS[tool]}
  </svg>
}

const clampRow = (row: number) => Math.min(MAX_ROW, Math.max(0, row))

export function App() {
  const [editor, setEditor] = useState(() => new Editor())
  const [revision, setRevision] = useState(0)
  const revisionCounter = useRef(0)
  const refresh = () => { revisionCounter.current++; setRevision(revisionCounter.current) }
  const [agentDocument, setAgentDocument] = useState(0)
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 })
  const [top, setTop] = useState(0)
  const [visibleRows, setVisibleRows] = useState(25)
  const [fg, setFg] = useState(7)
  const [bg, setBg] = useState(0)
  const [code, setCode] = useState(219)
  const [palette, setPalette] = useState(0)
  const [tool, setActiveTool] = useState<Tool>('draw')
  const [path, setPath] = useState<BezierPath>()
  const [pathNode, setPathNode] = useState<number>()
  const pathDraft = useRef<BezierPath | undefined>(undefined)
  const [pathSubtract, setPathSubtract] = useState(false)
  const pathDrag = useRef<{
    index: number; part: keyof PathNode | 'new'; start: Point; node: PathNode; before: BezierPath; beforeSelection?: number
  } | undefined>(undefined)
  const [drawMode, setDrawMode] = useState<'full' | 'half'>('full')
  const [movePreview, setMovePreview] = useState<ReadonlyMap<string, Cell>>()
  const moveDrag = useRef<{
    start: Point; region: ReadonlyMap<string, Cell>; cells: ReadonlyMap<string, Cell>
  } | undefined>(undefined)
  const [fillMode, setFillMode] = useState<FillMode>('shape')
  const [primitiveKind, setPrimitiveKind] = useState<PrimitiveKind>('rectangle')
  const [primitiveFilled, setPrimitiveFilled] = useState(true)
  const [primitiveSubtract, setPrimitiveSubtract] = useState(false)
  const [primitivePreview, setPrimitivePreview] = useState<ReadonlyMap<string, Cell>>()
  const primitiveDrag = useRef<{
    start: Point; end: Point; angle: number; clientX: number
    kind: PrimitiveKind; filled: boolean; subtract: boolean; fg: number; bg: number; cells: ReadonlyMap<string, Cell>
  } | undefined>(undefined)
  const [gradientKind, setGradientKind] = useState<GradientKind>('linear')
  const [gradientPreview, setGradientPreview] = useState<ReadonlyMap<string, Cell>>()
  const [gradientLine, setGradientLine] = useState<GradientLine>()
  const gradientDrag = useRef<{
    start: Point; end: Point; kind: GradientKind; fg: number; bg: number
    region: ReadonlyMap<string, Cell>; cells: ReadonlyMap<string, Cell>
  } | undefined>(undefined)
  const [anchor, setAnchor] = useState<Point>()
  const [selectionEnd, setSelectionEnd] = useState<Point>()
  const [clipboard, setClipboard] = useState<Block>()
  const [showPreview, setShowPreview] = useState(true)
  const [ansimation, setAnsimation] = useState<{ source: AnimationFrame; top: number }>()
  const [showSauce, setShowSauce] = useState(false)
  const [cellSize, setCellSize] = useState<typeof CANVAS_SIZES[number]>(CANVAS_SIZES[0])
  const [font, setFont] = useState<CanvasFont>('ibm-vga')
  const [name, setName] = useState('untitled.ans')
  const [message, setMessage] = useState('Ready. Click the canvas to draw, or use the keyboard.')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [opening, setOpening] = useState(false)
  const [goRow, setGoRow] = useState('1')
  const [openMenu, setOpenMenu] = useState<'File' | 'Edit' | 'Window' | 'Settings' | 'Help'>()
  const [dialogKind, setDialogKind] = useState<'font' | 'about'>('font')
  const menuBar = useRef<HTMLElement>(null)
  const infoDialog = useRef<HTMLDialogElement>(null)
  const settingsHeading = useRef<HTMLElement>(null)
  const helpHeading = useRef<HTMLElement>(null)
  const windowHeading = useRef<HTMLElement>(null)
  const fileHeading = useRef<HTMLElement>(null)
  const fileHandle = useRef<AnsiFileHandle | undefined>(undefined)
  const abortSave = useRef<AbortController | undefined>(undefined)
  const abortOpen = useRef<AbortController | undefined>(undefined)
  const lastPoint = useRef<Point | undefined>(undefined)
  const lastHalfPoint = useRef<HalfPoint | undefined>(undefined)
  const selection = useMemo(() => anchor && selectionEnd ? rectangle(anchor, selectionEnd) : undefined, [anchor, selectionEnd])
  const dirty = editor.dirty
  const tundra = editor.format === 'tundra'
  const selectedPathNode = pathNode === undefined ? undefined : path?.nodes[pathNode]
  const pathNodeCurved = selectedPathNode && [selectedPathNode.incoming, selectedPathNode.outgoing]
    .some(handle => handle.x !== selectedPathNode.point.x || handle.y !== selectedPathNode.point.y)
  const pathResult = useMemo(() => {
    if (!path?.closed || path.nodes.length < 3) return { revision }
    try {
      return { revision, cells: rasterizePath(path, { fg, bg }, pathSubtract ? editor.cells : undefined, editor.format) }
    } catch (cause) {
      return { revision, error: cause instanceof Error ? cause.message : String(cause), cause }
    }
    // Revision tracks edits to the mutable Editor, including subtraction's source art.
  }, [path, fg, bg, pathSubtract, editor, revision])
  const pathPreview = pathResult.cells
  useEffect(() => {
    if (pathResult.error) console.error('ANSI Workshop:', pathResult.cause)
  }, [pathResult])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || path || saving || opening) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, path, saving, opening])

  useEffect(() => {
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !menuBar.current?.contains(event.target)) setOpenMenu(undefined)
    }
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('focusin', dismissOutside)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside)
      document.removeEventListener('focusin', dismissOutside)
    }
  }, [])

  const report = (cause: unknown) => {
    const text = cause instanceof Error ? cause.message : String(cause)
    console.error('ANSI Workshop:', cause)
    setError(text)
  }
  const cancelPath = () => {
    pathDraft.current = undefined; pathDrag.current = undefined
    setPath(undefined); setPathNode(undefined)
    setMessage('Path canceled. The document is unchanged.')
  }
  const setTool = (next: Tool) => {
    if (next !== 'path' && pathDraft.current) cancelPath()
    setActiveTool(next)
  }
  const updatePath = (next: BezierPath) => {
    pathDraft.current = next; setPath(next); setError('')
  }
  const deletePathNode = () => {
    const draft = pathDraft.current
    if (!draft?.nodes.length) { setMessage('Select a path node to delete.'); return }
    const index = pathNode ?? draft.nodes.length - 1
    const next = removePathNode(draft, index)
    if (!next.nodes.length) { cancelPath(); setMessage('Last node deleted. The path draft is cleared.'); return }
    updatePath(next)
    setPathNode(Math.min(index, next.nodes.length - 1))
    setMessage(next.nodes.length < 3 ? 'Node deleted. Add at least three nodes before finishing.' : 'Node deleted. Remaining nodes stay editable.')
  }
  const finishPath = () => {
    const draft = pathDraft.current
    if (!draft) { setMessage('Click the canvas to start a path.'); return }
    try {
      const cells = rasterizePath({ ...draft, closed: true }, { fg, bg }, pathSubtract ? editor.cells : undefined, editor.format)
      const version = editor.version
      for (const [id, cell] of cells) editor.paint(pointFromKey(id), cell)
      editor.commit(); refresh()
      pathDraft.current = undefined; pathDrag.current = undefined
      setPath(undefined); setPathNode(undefined); setError('')
      setMessage(editor.version === version ? 'Path unchanged. No cells were altered.'
        : pathSubtract ? 'Path subtracted. Undo restores the original art.' : 'Path filled. Undo removes the entire path.')
    } catch (cause) { report(cause) }
  }
  const move = (point: Point) => {
    const next = { x: Math.min(WIDTH - 1, Math.max(0, point.x)), y: clampRow(point.y) }
    setCursor(next)
    setTop(previous => next.y < previous ? next.y : next.y >= previous + visibleRows ? next.y - visibleRows + 1 : previous)
    return next
  }
  const scroll = useCallback((delta: number) => setTop(previous => clampRow(previous + delta)), [])
  const commit = () => { editor.commit(); lastPoint.current = undefined; lastHalfPoint.current = undefined; refresh() }
  const endPointer = (canceled: boolean) => {
    if (tool === 'path') {
      const drag = pathDrag.current
      pathDrag.current = undefined
      if (canceled && drag) { updatePath(drag.before); setPathNode(drag.beforeSelection) }
      return
    }
    const moving = moveDrag.current
    if (moving) {
      moveDrag.current = undefined
      setMovePreview(undefined)
      if (canceled) { setMessage('Move canceled. The document is unchanged.'); return }
      const version = editor.version
      for (const [id, cell] of moving.cells) editor.paint(pointFromKey(id), cell)
      editor.commit(); refresh()
      setMessage(editor.version === version ? 'Move unchanged.' : 'Shape moved. Undo restores its previous position and overwritten art.')
      return
    }
    const gradient = gradientDrag.current
    if (gradient) {
      gradientDrag.current = undefined
      setGradientPreview(undefined); setGradientLine(undefined)
      if (canceled) { setMessage('Gradient canceled. The document is unchanged.'); return }
      if (!gradient.cells.size) { setMessage('Gradient unchanged. Drag a line to set its direction and length.'); return }
      for (const [id, cell] of gradient.cells) editor.paint(pointFromKey(id), cell)
      editor.commit(); refresh()
      setMessage('Gradient placed. Undo removes the entire gradient.')
      return
    }
    const drag = primitiveDrag.current
    if (!drag) { commit(); return }
    primitiveDrag.current = undefined
    setPrimitivePreview(undefined)
    if (canceled) { setMessage('Primitive canceled. The document is unchanged.'); return }
    try {
      const cells = drag.subtract ? subtractPrimitive(editor.cells, drag.cells) : drag.cells
      const version = editor.version
      for (const [id, cell] of cells) editor.paint(pointFromKey(id), cell)
      editor.commit()
      refresh()
      setMessage(drag.subtract
        ? editor.version === version ? 'Subtraction unchanged. No cells were removed.' : 'Primitive subtracted. Undo restores the removed art.'
        : 'Primitive placed. Undo removes the entire shape.')
    } catch (cause) { report(cause) }
  }
  const undo = () => { if (pathDraft.current) return; editor.undo(); refresh() }
  const redo = () => { if (pathDraft.current) return; editor.redo(); refresh() }
  const historyKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog')) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault()
    if (primitiveDrag.current || gradientDrag.current || moveDrag.current) return
    if (key === 'y' || event.shiftKey) redo()
    else undo()
  }
  const place = (character: number) => {
    editor.paint(cursor, { code: character, fg, bg })
    editor.commit()
    move(cursor.x === WIDTH - 1 ? { x: 0, y: cursor.y + 1 } : { x: cursor.x + 1, y: cursor.y })
    refresh()
  }
  const copy = () => {
    if (!selection) { setMessage('Select a block first: choose Select, then drag across the canvas.'); return }
    setClipboard(editor.copy(selection))
    setMessage(`Copied ${selection.right - selection.left + 1} × ${selection.bottom - selection.top + 1} cells to the internal clipboard.`)
  }
  const cut = () => {
    if (!selection) return
    copy()
    editor.clear(selection); editor.commit(); refresh()
  }
  const paste = () => {
    if (!clipboard) return
    try { editor.paste(clipboard, cursor); editor.commit(); refresh(); setMessage('Block pasted at cursor (clipped at column 80).') }
    catch (cause) { report(cause) }
  }
  const flip = (axis: 'x' | 'y') => {
    if (!selection) return
    editor.flip(selection, axis); editor.commit(); refresh()
  }
  const clearSelection = () => { setAnchor(undefined); setSelectionEnd(undefined) }
  const navigate = (next: Point) => { clearSelection(); move(next) }
  const replaceDocument = (next: Editor, filename: string, handle?: AnsiFileHandle) => {
    if (next.format !== editor.format) { setFg(7); setBg(0) }
    setEditor(next); setCursor({ x: 0, y: 0 }); setTop(0); setGoRow('1')
    setAgentDocument(value => value + 1)
    fileHandle.current = handle; setName(filename); clearSelection()
    lastPoint.current = undefined
    lastHalfPoint.current = undefined
    primitiveDrag.current = undefined; setPrimitivePreview(undefined)
    gradientDrag.current = undefined; setGradientPreview(undefined); setGradientLine(undefined)
    moveDrag.current = undefined; setMovePreview(undefined)
    pathDraft.current = undefined; pathDrag.current = undefined; setPath(undefined); setPathNode(undefined)
    setError(''); refresh()
  }
  const newFile = (format: DocumentFormat = 'ansi') => {
    if (saving || abortOpen.current) return
    if ((editor.dirty || pathDraft.current) && !window.confirm('Discard unsaved changes and start a new screen?')) return
    replaceDocument(new Editor(undefined, undefined, format), format === 'tundra' ? 'untitled.tnd' : 'untitled.ans')
    setMessage('New 80-column screen. Rows grow as you draw.')
  }
  const openFile = async () => {
    if (saving || abortOpen.current) return
    if ((editor.dirty || pathDraft.current) && !window.confirm('Discard unsaved changes and open another art file?')) return
    const startingRevision = revisionCounter.current
    const startingPath = pathDraft.current
    const controller = new AbortController()
    abortOpen.current = controller
    setOpening(true); setError('')
    setMessage('Choose an ANSI or TundraDraw file to open. The current document stays in memory until opening succeeds.')
    try {
      const { file, handle } = await chooseAnsiFile(true)
      controller.signal.throwIfAborted()
      setMessage(`Opening ${file.name}…`)
      const format = /\.tnd$/i.test(file.name) ? 'tundra' : 'ansi'
      const { cells, sauce } = await (format === 'tundra' ? readTundraDocument : readAnsiDocument)(file, controller.signal)
      controller.signal.throwIfAborted()
      if (((revisionCounter.current !== startingRevision && editor.dirty) ||
           (pathDraft.current && pathDraft.current !== startingPath)) &&
          !window.confirm('The current document changed while opening. Discard these latest changes and open the file?')) {
        setMessage('Open canceled. The current document is unchanged.')
        return
      }
      replaceDocument(new Editor(cells, sauce, format), file.name, handle)
      setTool('draw')
      setMessage(`Opened ${file.name}.${handle ? ' Save writes to this browser-authorized file.' : ' Use Save As to choose where to write; this file selection grants read access only.'}`)
    } catch (cause) {
      if ((controller.signal.aborted && cause === controller.signal.reason) ||
          (cause instanceof DOMException && cause.name === 'AbortError')) setMessage('Open canceled. The current document is unchanged.')
      else { setMessage('Open failed. The current document is unchanged.'); report(cause) }
    } finally { abortOpen.current = undefined; setOpening(false) }
  }
  const save = async (saveAs: boolean, asciiCopy = false) => {
    if (saving || abortOpen.current) return
    editor.commit()
    setSaving(true); setError('')
    const controller = new AbortController()
    abortSave.current = controller
    const version = editor.version
    const snapshot = new Map(editor.cells)
    const sauce = editor.sauce
    const outputName = asciiCopy ? `${name.replace(/\.[^.]*$/, '')}.asc` : name
    try {
      const handle = asciiCopy ? await chooseFile(outputName, 'ascii')
        : saveAs || !fileHandle.current ? await (tundra ? chooseFile(name, 'tundra') : chooseFile(name)) : fileHandle.current
      if (asciiCopy) await writeAscii(snapshot, handle, outputName, controller.signal)
      else await (tundra ? writeTundra : writeAnsi)(snapshot, handle, outputName, controller.signal, sauce)
      if (!asciiCopy) fileHandle.current = handle
      if (handle) {
        if (asciiCopy) setMessage(`Saved ASCII copy ${handle.name} without colors. The ANSI document and save destination are unchanged.`)
        else {
          setName(handle.name); editor.markSaved(version)
          setMessage(`Saved ${handle.name}.`)
        }
      } else {
        setMessage('Download requested. Check your browser downloads; delivery cannot be verified. Use Chrome/Edge for native directory picking.')
      }
      if (pathDraft.current) setMessage(previous => `${previous} Unfinished path not included; Finish it before the next save.`)
      refresh()
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') setMessage('Save canceled. Changes are still in memory.')
      else report(cause)
    } finally { setSaving(false); abortSave.current = undefined }
  }
  const keyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (tool === 'path' && pathDraft.current) {
      if (event.key === 'Tab') return
      event.preventDefault()
      if (event.key === 'Escape') cancelPath()
      else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) finishPath()
      else if ((event.key === 'Backspace' || event.key === 'Delete') && !pathDrag.current) deletePathNode()
      return
    }
    if (primitiveDrag.current || gradientDrag.current || moveDrag.current) {
      event.preventDefault()
      return
    }
    if (event.altKey) return
    if (event.ctrlKey || event.metaKey) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        const cycle = (value: number, count: number, delta: number) => value < count ? (value + count + delta) % count : delta > 0 ? 0 : count - 1
        if (event.key === 'ArrowLeft') setFg(value => cycle(value, ANSI_COLORS.length, -1))
        if (event.key === 'ArrowRight') setFg(value => cycle(value, ANSI_COLORS.length, 1))
        if (event.key === 'ArrowUp') setBg(value => cycle(value, tundra ? 16 : BACKGROUND_COLORS.length, -1))
        if (event.key === 'ArrowDown') setBg(value => cycle(value, tundra ? 16 : BACKGROUND_COLORS.length, 1))
        return
      }
      const key = event.key.toLowerCase()
      if (['s', 'o', 'c', 'x', 'v', 'a', 'n'].includes(key)) event.preventDefault()
      if (key === 's') void save(event.shiftKey)
      if (key === 'o') void openFile()
      if (key === 'c') copy()
      if (key === 'x') cut()
      if (key === 'v') paste()
      if (key === 'n') newFile(editor.format)
      if (key === 'a') { setAnchor({ x: 0, y: 0 }); setSelectionEnd({ x: WIDTH - 1, y: editor.lastRow }); setTool('select') }
      return
    }
    const functionKey = /^F([1-9]|1[0-2])$/.exec(event.key)
    if (functionKey) {
      event.preventDefault()
      const mapped = PALETTES[palette].codes[Number(functionKey[1]) - 1]
      if (mapped !== undefined) { setCode(mapped); place(mapped) }
      return
    }
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      PageUp: { x: 0, y: -visibleRows }, PageDown: { x: 0, y: visibleRows },
    }
    const delta = deltas[event.key]
    if (delta) {
      event.preventDefault()
      const next = move({ x: cursor.x + delta.x, y: cursor.y + delta.y })
      if (event.shiftKey) { if (!anchor) setAnchor(cursor); setSelectionEnd(next) }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); move({ x: event.key === 'Home' ? 0 : WIDTH - 1, y: cursor.y }); return
    }
    if (event.key === 'Enter') { event.preventDefault(); move({ x: 0, y: cursor.y + 1 }); return }
    if (event.key === 'Escape') { clearSelection(); setTool('draw'); return }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (selection) editor.clear(selection)
      else {
        const point = event.key === 'Backspace' ? move({ x: Math.max(0, cursor.x - 1), y: cursor.y }) : cursor
        editor.paint(point, EMPTY)
      }
      editor.commit(); refresh(); return
    }
    if (event.key.length === 1) {
      const typed = characterCode(event.key)
      if (typed !== undefined) { event.preventDefault(); place(typed) }
      else setMessage('That character is not available in CP437.')
    }
  }
  const selectPoint = (next: Point, start: boolean) => {
    setCursor(next)
    if (start) setAnchor(next)
    setSelectionEnd(next)
  }
  const point = (next: Point, start: boolean, pointer: PointerInput) => {
    if (!validPoint(next)) return
    if (tool === 'path') {
      const draft = pathDraft.current ?? { origin: next.y, nodes: [], closed: false }
      const position = { x: next.x + pointer.subcell.x, y: next.y - draft.origin + pointer.subcell.y }
      setCursor(next); clearSelection()
      if (start) {
        let hit: { index: number; part: keyof PathNode } | undefined
        let nearest = 1
        for (let index = 0; index < draft.nodes.length; index++) {
          const node = draft.nodes[index]
          for (const part of ['point', 'incoming', 'outgoing'] as const) {
            if (part !== 'point' && node[part].x === node.point.x && node[part].y === node.point.y) continue
            const distance = Math.hypot((node[part].x - position.x) / pointer.tolerance.x,
              (node[part].y - position.y) / pointer.tolerance.y)
            if (distance < nearest) { hit = { index, part }; nearest = distance }
          }
        }
        if (hit?.index === 0 && hit.part === 'point' && !draft.closed && draft.nodes.length >= 3) {
          updatePath({ ...draft, closed: true })
          setPathNode(0)
          setMessage('Path closed. Drag nodes or handles to adjust; Finish or Enter applies it.')
          return
        }
        if (hit) {
          pathDrag.current = { ...hit, start: position, node: draft.nodes[hit.index], before: draft, beforeSelection: pathNode }
          setPathNode(hit.index)
        } else if (!draft.closed) {
          const node = { point: position, incoming: position, outgoing: position }
          pathDrag.current = { index: draft.nodes.length, part: 'new', start: position, node, before: draft, beforeSelection: pathNode }
          setPathNode(draft.nodes.length)
          updatePath({ ...draft, nodes: [...draft.nodes, node] })
        } else {
          setMessage('Drag a node or handle to edit the closed path; Finish or Enter applies it.')
          return
        }
      } else {
        const drag = pathDrag.current
        if (!drag) return
        const dx = position.x - drag.start.x, dy = position.y - drag.start.y
        const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
        const node = drag.part === 'new'
          ? { ...drag.node, outgoing: position, incoming: { x: 2 * drag.node.point.x - position.x, y: 2 * drag.node.point.y - position.y } }
          : drag.part === 'point'
            ? { point: shift(drag.node.point), incoming: shift(drag.node.incoming), outgoing: shift(drag.node.outgoing) }
            : { ...draft.nodes[drag.index], [drag.part]: shift(drag.node[drag.part]) }
        updatePath({ ...draft, nodes: draft.nodes.map((value, index) => index === drag.index ? node : value) })
      }
      setMessage(draft.closed ? 'Path closed. Drag nodes or handles; Finish or Enter applies; Escape cancels.'
        : 'Click to add nodes; drag to create curves. Click the first node to close; Finish or Enter applies; Escape cancels.')
    } else if (tool === 'fill' || tool === 'eyedropper') {
      if (!start) return
      clearSelection()
      setCursor(next)
      setError('')
      if (tool === 'eyedropper') {
        const cell = editor.cell(next)
        setFg(cell.fg); setBg(cell.bg)
        setMessage(`Picked foreground ${colorName(cell.fg)} and background ${colorName(cell.bg)}. Brush glyph unchanged.`)
      } else {
        try {
          const cells = bucketFill(editor.cells, next, fillMode, fg, editor.format)
          for (const [id, cell] of cells) editor.paint(pointFromKey(id), cell)
          editor.commit(); refresh()
          setMessage(`Filled ${cells.size} connected cells with ${colorName(fg)}. Undo removes the entire fill.`)
        } catch (cause) { report(cause) }
      }
    } else if (tool === 'move') {
      try {
        if (start) {
          clearSelection()
          setError('')
          moveDrag.current = { start: next, region: connectedShape(editor.cells, next), cells: new Map() }
        }
        const drag = moveDrag.current
        if (!drag) return
        drag.cells = moveShape(drag.region, { x: next.x - drag.start.x, y: next.y - drag.start.y })
        setCursor(next)
        setMovePreview(drag.cells)
        setMessage(`Moving ${drag.region.size} connected cells. Release to place; Escape cancels. Shape stays within canvas edges.`)
      } catch (cause) {
        moveDrag.current = undefined; setMovePreview(undefined)
        report(cause)
      }
    } else if (tool === 'gradient') {
      try {
        if (start) {
          clearSelection()
          setError('')
          gradientDrag.current = {
            start: next, end: next, kind: gradientKind, fg, bg,
            region: gradientRegion(editor.cells, next), cells: new Map(),
          }
        }
        const drag = gradientDrag.current
        if (!drag) return
        drag.end = next
        drag.cells = rasterizeGradient(drag.region, drag.kind, drag.start, drag.end, drag, editor.format)
        setCursor(next)
        setGradientPreview(drag.cells)
        setGradientLine({ start: drag.start, end: drag.end })
        setMessage(`${drag.kind === 'linear' ? 'Linear' : 'Radial'} gradient: foreground at start, background at end. Release to shade ${drag.region.size} matching connected cells; Escape cancels.`)
      } catch (cause) {
        gradientDrag.current = undefined; setGradientPreview(undefined); setGradientLine(undefined)
        report(cause)
      }
    } else if (tool === 'primitive') {
      if (start) {
        clearSelection()
        setError('')
        primitiveDrag.current = {
          start: next, end: next, angle: 0, clientX: pointer.clientX,
          kind: primitiveKind, filled: primitiveFilled, subtract: primitiveSubtract, fg, bg, cells: new Map(),
        }
      }
      const drag = primitiveDrag.current
      if (!drag) return
      if (pointer.altKey) drag.angle += (pointer.clientX - drag.clientX) * Math.PI / 180
      else drag.end = next
      drag.clientX = pointer.clientX
      setCursor(next)
      try {
        drag.cells = rasterizePrimitive(drag.kind, drag.filled, drag.start, drag.end, drag.angle, drag)
        setPrimitivePreview(drag.cells)
        setMessage(`${drag.subtract ? 'Subtraction' : 'Primitive'} preview: ${Math.abs(drag.end.x - drag.start.x) + 1} x ${Math.abs(drag.end.y - drag.start.y) + 1}, ${Math.round(drag.angle * 180 / Math.PI)} degrees. Alt+drag rotates; release to ${drag.subtract ? 'subtract' : 'place'}; Escape cancels.`)
      } catch (cause) {
        primitiveDrag.current = undefined; setPrimitivePreview(undefined)
        report(cause)
      }
    } else if (tool === 'select') {
      selectPoint(next, start)
    } else {
      setCursor(next)
      if (tool === 'draw' && drawMode === 'half') {
        try {
          const pixel = { ...next, half: pointer.half }
          const first = start || !lastHalfPoint.current ? pixel : lastHalfPoint.current
          const cells = rasterizeHalfBlockStroke(editor.cells, first, pixel, { fg, bg })
          for (const [id, cell] of cells) editor.paint(pointFromKey(id), cell)
          lastHalfPoint.current = pixel
          lastPoint.current = next
          refresh()
        } catch (cause) { report(cause) }
        return
      }
      const cell = tool === 'erase' ? EMPTY : { code, fg, bg }
      for (const value of linePoints(start || !lastPoint.current ? next : lastPoint.current, next)) {
        if (tool === 'recolor') {
          const existing = editor.cell(value)
          if (existing !== EMPTY) editor.paint(value, { ...existing, fg, bg })
        } else editor.paint(value, cell)
      }
      lastPoint.current = next
      refresh()
    }
  }
  const closeMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) {
      setOpenMenu(undefined)
      event.currentTarget.closest('details')?.querySelector('summary')?.focus()
    }
  }
  const toggleMenu = (event: React.MouseEvent<HTMLElement>, menu: typeof openMenu) => {
    event.preventDefault()
    setOpenMenu(previous => previous === menu ? undefined : menu)
  }
  const hoverMenu = (menu: typeof openMenu) => {
    setOpenMenu(previous => previous ? menu : undefined)
  }
  const showInfo = (kind: typeof dialogKind) => {
    setDialogKind(kind)
    setOpenMenu(undefined)
    infoDialog.current?.showModal()
    const content = infoDialog.current?.querySelector<HTMLDivElement>('.info-dialog-content')
    if (content) content.scrollTop = 0
  }

  return <div className="app-shell" onKeyDown={historyKeyDown}>
    <header className="app-header">
      <div className="brand-mark" aria-hidden="true">▟</div>
      <div><h1>ANSI<span>WORKSHOP</span></h1><p>A little old school. A limitless canvas.</p></div>
      <div className="document-title">{name}{dirty ? ' *' : ''}<span>CP437 · 80 columns</span></div>
      <span className="local-badge"><span />LOCAL ONLY</span>
    </header>
    <nav ref={menuBar} className="menu-bar" aria-label="Application menu" onKeyDown={event => {
      if (event.key === 'Escape' && openMenu) {
        event.preventDefault()
        event.stopPropagation()
        menuBar.current?.querySelector<HTMLDetailsElement>('details[open]')?.querySelector('summary')?.focus()
        setOpenMenu(undefined)
      }
    }}>
      <details open={openMenu === 'File'}><summary ref={fileHeading} onMouseEnter={() => hoverMenu('File')} onClick={event => toggleMenu(event, 'File')}>File</summary><div className="menu-popup" onClick={closeMenu}>
        <button onClick={() => newFile(editor.format)} disabled={saving || opening}>New <kbd>Ctrl N</kbd></button>
        {tundra && <button onClick={() => newFile('ansi')} disabled={saving || opening}>New ANSI…</button>}
        <button onClick={() => newFile('tundra')} disabled={saving || opening}>New TundraDraw…</button>
        <button onClick={() => void openFile()} disabled={saving || opening}>Open… <kbd>Ctrl O</kbd></button>
        <button onClick={() => void save(false)} disabled={saving || opening}>Save <kbd>Ctrl S</kbd></button>
        <button onClick={() => void save(true)} disabled={saving || opening}>Save As… <kbd>Ctrl Shift S</kbd></button>
        <button onClick={() => void save(true, true)} disabled={saving || opening} title="Save a CP437 copy without ANSI codes or colors; keep the ANSI save destination.">Save As ASCII…</button>
        <button onClick={() => { editor.commit(); refresh(); setShowSauce(true) }} disabled={saving || opening}>SAUCE…</button>
      </div></details>
      <details open={openMenu === 'Edit'}><summary onMouseEnter={() => hoverMenu('Edit')} onClick={event => toggleMenu(event, 'Edit')}>Edit</summary><div className="menu-popup wide-menu" onClick={closeMenu}>
        <button onClick={undo} disabled={!editor.canUndo || !!path}>Undo <kbd>Ctrl Z</kbd></button>
        <button onClick={redo} disabled={!editor.canRedo || !!path}>Redo <kbd>Ctrl Shift Z</kbd></button>
        <div className="menu-label">Block operations</div>
        <button onClick={() => setTool(tool === 'select' ? 'draw' : 'select')}>{tool === 'select' ? '✓ ' : ''}Block select toggle</button>
        <button onClick={copy} disabled={!selection}>Copy <kbd>Ctrl C</kbd></button>
        <button onClick={cut} disabled={!selection || !!path}>Cut <kbd>Ctrl X</kbd></button>
        <button onClick={paste} disabled={!clipboard || !!path}>Paste at cursor <kbd>Ctrl V</kbd></button>
        <button onClick={() => flip('x')} disabled={!selection || !!path}>Flip X (mirror horizontally)</button>
        <button onClick={() => flip('y')} disabled={!selection || !!path}>Flip Y (mirror vertically)</button>
        <button disabled={!selection || !!path} onClick={() => { if (selection) { editor.clear(selection); editor.commit(); refresh() } }}>Delete block</button>
        <button onClick={clearSelection} disabled={!selection}>Deselect <kbd>Esc</kbd></button>
      </div></details>
      <details open={openMenu === 'Window'}><summary ref={windowHeading} onMouseEnter={() => hoverMenu('Window')} onClick={event => toggleMenu(event, 'Window')}>Window</summary><div className="menu-popup" onClick={closeMenu}>
        <button onClick={() => setShowPreview(value => !value)}>{showPreview ? 'Hide' : 'Show'} VGA Preview</button>
        <button disabled={saving || opening || tundra} title={tundra ? 'Ansimation supports classic ANSI documents only.' : undefined} onClick={() => {
          try { setAnsimation({ source: captureFrame(editor.cells, top), top }) }
          catch (cause) { report(cause) }
        }}>Ansimation (experimental)…</button>
      </div></details>
      <details open={openMenu === 'Settings'}><summary ref={settingsHeading} onMouseEnter={() => hoverMenu('Settings')} onClick={event => toggleMenu(event, 'Settings')}>Settings</summary>
        <div className="menu-popup settings-menu">
          <label>Canvas font<select aria-label="Canvas font" value={font} onChange={event => {
            const value = event.target.value
            if (value === 'ibm-vga' || value === 'consolas') setFont(value)
            else report(new Error('Unknown canvas font.'))
          }}>
            <option value="ibm-vga">IBM VGA 8×16</option>
            <option value="consolas">Consolas (system font)</option>
          </select></label>
          <label>Canvas cell size<select aria-label="Canvas cell size" value={cellSize.id} onChange={event => {
            const next = CANVAS_SIZES.find(size => size.id === event.target.value)
            if (next) setCellSize(next)
            else report(new Error('Unknown canvas cell size.'))
          }}>{CANVAS_SIZES.map(size => <option key={size.id} value={size.id}>{size.label}</option>)}</select></label>
          <p>{font === 'consolas' ? 'Consolas uses your installed font, with Courier New / monospace fallback. Its pixels vary by browser and platform.'
            : cellSize.id === 'classic' ? 'IBM bitmap enlarged 1.25× with nearest-neighbor pixels. Pixel widths and heights are uneven.'
              : 'Exact IBM bitmap pixels at native size or 2× in the canvas backing image.'}</p>
          <p>Zoom, OS scaling, and the preview thumbnail can rescale screen pixels. Settings last until reload.</p>
          <p className="font-credit">IBM font by <a href="https://int10h.org/oldschool-pc-fonts/" target="_blank" rel="noreferrer">VileR</a> · CC BY-SA 4.0.
            {' '}Converted to a CP437 bitmap; glyph designs unchanged.</p>
          <button className="font-notices-button" onClick={() => showInfo('font')}>IBM font license and notices</button>
        </div>
      </details>
      <details open={openMenu === 'Help'}><summary ref={helpHeading} onMouseEnter={() => hoverMenu('Help')} onClick={event => toggleMenu(event, 'Help')}>Help</summary><div className="menu-popup" onClick={closeMenu}>
        <button onClick={() => showInfo('about')}>About ANSI Workshop</button>
      </div></details>
      <div className="menu-hint">No cloud. No accounts. Just characters.</div>
    </nav>
    <dialog ref={infoDialog} className="info-dialog" aria-labelledby="info-dialog-title"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.close()
        }
      }}
      onClose={() => (dialogKind === 'about' ? helpHeading : settingsHeading).current?.focus()}>
      <div className="info-dialog-header">
        <h2 id="info-dialog-title">{dialogKind === 'about' ? 'About ANSI Workshop' : 'IBM font license and notices'}</h2>
        <button autoFocus onClick={() => infoDialog.current?.close()}>Close</button>
      </div>
      <div className="info-dialog-content" tabIndex={0}>
        {dialogKind === 'about' && <>
          <h3>ANSI Workshop</h3>
          <p>Version {RELEASE_VERSION}</p>
          <p>A local-first, 80-column CP437 ANSI art editor. Artwork stays in your browser; there is no automatic persistence.</p>
          <p><a href="https://github.com/wood-commits/ansi-workshop" target="_blank" rel="noreferrer">GitHub project</a>
            {' '}&middot;{' '}<a href="https://wood-commits.github.io/ansi-workshop/" target="_blank" rel="noreferrer">Hosted static editor</a></p>
          <h3>Editor license (MIT)</h3>
          <pre aria-label="Full MIT license">{editorLicense}</pre>
          <p>The MIT license covers the editor code, not the separately licensed font or third-party example artwork and reference images.</p>
        </>}
        <h3>Font notices</h3>
        <pre aria-label="Font notices">{fontNotice}</pre>
        <h3>Full CC BY-SA 4.0 license</h3>
        <pre aria-label="Full CC BY-SA 4.0 license">{fontLicense}</pre>
      </div>
    </dialog>
    {showSauce && <SauceDialog sauce={editor.sauce} rows={editor.lastRow + 1} format={editor.format}
      onApply={sauce => {
        const version = editor.version
        editor.setSauce(sauce); refresh()
        setMessage(editor.version === version ? 'SAUCE unchanged.' : sauce
          ? 'SAUCE metadata updated. Save the document to write it.'
          : 'SAUCE metadata removed. Save the document to write the change.')
      }}
      onClose={() => { setShowSauce(false); fileHeading.current?.focus() }} />}
    <div className="toolbar">
      <div className="tool-group" aria-label="Drawing tools">
        <button aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}><ToolIcon tool="draw" />Draw</button>
        <button aria-pressed={tool === 'cursor'} title="Move cursor without painting (Alt+click with any tool)" onClick={() => setTool('cursor')}><ToolIcon tool="cursor" />Cursor</button>
        <button aria-pressed={tool === 'erase'} onClick={() => setTool('erase')}><ToolIcon tool="erase" />Erase</button>
        <button aria-pressed={tool === 'recolor'} title="Drag to change existing cells' foreground and background without changing their glyphs" onClick={() => setTool('recolor')}><ToolIcon tool="recolor" />Recolor</button>
        <button aria-pressed={tool === 'select'} onClick={() => setTool('select')}><ToolIcon tool="select" />Select</button>
        <button aria-pressed={tool === 'move'} title="Drag all side-connected painted cells, regardless of color or glyph" onClick={() => setTool('move')}><ToolIcon tool="move" />Move</button>
        <button aria-pressed={tool === 'primitive'} onClick={() => setTool('primitive')}><ToolIcon tool="primitive" />Primitive</button>
        <button aria-pressed={tool === 'path'} onClick={() => setTool('path')}><ToolIcon tool="path" />Path</button>
        <button aria-pressed={tool === 'gradient'} onClick={() => setTool('gradient')}><ToolIcon tool="gradient" />Gradient</button>
        <button aria-pressed={tool === 'fill'} title="Fill with the selected foreground color" onClick={() => setTool('fill')}><ToolIcon tool="fill" />Fill</button>
        <button aria-pressed={tool === 'eyedropper'} title="Pick foreground and background colors without changing the brush glyph" onClick={() => setTool('eyedropper')}><ToolIcon tool="eyedropper" />Eyedropper</button>
      </div>
      <div className="tool-group history-tools">
        <button onClick={undo} disabled={!editor.canUndo || !!path} title="Undo">↶</button>
        <button onClick={redo} disabled={!editor.canRedo || !!path} title="Redo">↷</button>
      </div>
      <form className="row-navigation" onSubmit={event => {
        event.preventDefault()
        const row = Number(goRow)
        if (!/^[0-9]+$/.test(goRow) || !Number.isSafeInteger(row) || row < 1 || row > MAX_ROW) {
          setError(`Enter a whole row number from 1 to ${MAX_ROW}.`); return
        }
        setError(''); setTop(row - 1); setCursor({ x: cursor.x, y: row - 1 })
      }}>
        <label htmlFor="row-number">Go to row</label>
        <input id="row-number" inputMode="numeric" value={goRow} onChange={event => setGoRow(event.target.value)} />
        <button type="submit">Go</button>
      </form>
      {opening && <button onClick={() => abortOpen.current?.abort()}>Cancel open</button>}
      {saving && <button onClick={() => abortSave.current?.abort()}>Cancel save</button>}
      <div className="tool-options" role="group" aria-label="Tool options">
        {tool === 'draw' && <div className="primitive-controls">
          <label>Mode <select aria-label="Draw mode" value={drawMode} onChange={event => {
            const value = event.target.value
            if (value === 'full' || value === 'half') setDrawMode(value)
          }}>
            <option value="full">Full Block</option><option value="half">Half Block</option>
          </select></label>
          <span className="muted">{drawMode === 'full' ? 'Drag to paint with the selected character and colors'
            : 'Drag at half-row resolution with FG and BG · Matching halves merge · Brush glyph ignored'}</span>
        </div>}
        {tool === 'cursor' && <span className="muted">Click to move the cursor without painting</span>}
        {tool === 'erase' && <span className="muted">Drag to restore default blank cells</span>}
        {tool === 'recolor' && <span className="muted">Drag to recolor existing cells with FG and BG · Glyphs unchanged · Blank cells untouched</span>}
        {tool === 'select' && <span className="muted">Drag to select a block · Shift+arrows extends the selection</span>}
        {tool === 'move' && <span className="muted">Drag connected art to move it · Destination cells are overwritten · Esc cancels</span>}
        {tool === 'path' && <div className="primitive-controls">
          <label>Mode <select aria-label="Path mode" title="Fill uses FG/BG. Subtract cuts to BG and approximates clipped glyphs." value={pathSubtract ? 'subtract' : 'fill'} onChange={event => {
            const value = event.target.value
            if (value !== 'fill' && value !== 'subtract') { report(new Error('Unknown path mode.')); return }
            const subtract = value === 'subtract'
            setPathSubtract(subtract)
          }}><option value="fill">Fill</option><option value="subtract">Subtract</option></select></label>
          <button disabled={!path || path.nodes.length < 3} onClick={() => {
            if (pathDraft.current) updatePath({ ...pathDraft.current, closed: !pathDraft.current.closed })
          }}>{path?.closed ? 'Reopen path' : 'Close path'}</button>
          <button disabled={!path || path.nodes.length < 3} onClick={finishPath}>Finish path</button>
          <button disabled={!path} onClick={cancelPath}>Cancel path</button>
          <label>Node <select aria-label="Path node" value={pathNode ?? ''} disabled={!path?.nodes.length} onChange={event => {
            const index = Number(event.target.value)
            if (!path || !Number.isInteger(index) || index < 0 || index >= path.nodes.length) {
              report(new Error('Select an existing path node.')); return
            }
            setPathNode(index)
          }}>
            {pathNode === undefined && <option value="">Select node</option>}
            {path?.nodes.map((_node, index) => <option key={index} value={index}>Node {index + 1}</option>)}
          </select></label>
          <button disabled={pathNode === undefined} onClick={deletePathNode}>Delete node</button>
          {(['Corner', 'Curve'] as const).map(kind => <button key={kind}
            aria-pressed={!!selectedPathNode && (kind === 'Curve') === !!pathNodeCurved}
            disabled={!selectedPathNode || (kind === 'Curve') === !!pathNodeCurved} onClick={() => {
            if (pathDraft.current && pathNode !== undefined) {
              updatePath(convertPathNode(pathDraft.current, pathNode, kind === 'Curve'))
              setMessage(`Node ${pathNode + 1} converted to ${kind.toLowerCase()}. Drag its node or handles to adjust.`)
            }
          }}>Make {kind.toLowerCase()}</button>)}
          <span className="muted">Drag nodes/handles · Enter finishes · Esc cancels</span>
        </div>}
        {tool === 'primitive' && <div className="primitive-controls">
          <label>Mode <select aria-label="Primitive mode" value={primitiveSubtract ? 'subtract' : 'draw'} onChange={event => setPrimitiveSubtract(event.target.value === 'subtract')}>
            <option value="draw">Draw</option><option value="subtract">Subtract</option>
          </select></label>
          <label>Shape <select aria-label="Primitive shape" value={primitiveKind} onChange={event => {
            const value = event.target.value
            if (value === 'rectangle' || value === 'ellipse' || value === 'rounded-rectangle' || value === 'star') setPrimitiveKind(value)
          }}>
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Circle / ellipse</option>
            <option value="rounded-rectangle">Rounded rectangle</option>
            <option value="star">Star</option>
          </select></label>
          <label>Style <select aria-label="Primitive style" value={primitiveFilled ? 'filled' : 'outline'} onChange={event => setPrimitiveFilled(event.target.value === 'filled')}>
            <option value="filled">Filled</option><option value="outline">Outline</option>
          </select></label>
          <span className="muted">Drag to size · Alt rotates · Esc cancels</span>
        </div>}
        {tool === 'gradient' && <div className="primitive-controls">
          <label>Type <select aria-label="Gradient type" value={gradientKind} onChange={event => {
            const value = event.target.value
            if (value === 'linear' || value === 'radial') setGradientKind(value)
          }}>
            <option value="linear">Linear</option><option value="radial">Radial</option>
          </select></label>
          <span className="muted">Drag FG to BG over matching connected cells · Esc cancels</span>
        </div>}
        {tool === 'fill' && <div className="primitive-controls">
          <label>Mode <select aria-label="Fill behavior" value={fillMode} onChange={event => {
            const value = event.target.value
            if (value === 'shape' || value === 'enclosed') setFillMode(value)
          }}>
            <option value="shape">Recolor shape</option><option value="enclosed">Fill enclosed blank area</option>
          </select></label>
          <span className="muted">Click to fill with FG · Half-block edges stay intact</span>
        </div>}
        {tool === 'eyedropper' && <span className="muted">Click a cell to pick its FG and BG · Brush glyph unchanged</span>}
      </div>
    </div>
    <main className="workspace">
      <section className="editor-panel" aria-label="Screen editor">
        <div className="canvas-heading"><span><span className="live-dot" /> {name}{dirty ? ' · modified' : ''}</span><span>80 × ∞ <span className="muted">/ {tundra ? 'TundraDraw' : 'ANSI'}</span></span></div>
        <ArtCanvas key={`canvas-${agentDocument}`} editor={editor} revision={revision} cursor={cursor} top={top} selection={selection} tool={tool} selecting={tool === 'select'} cellSize={cellSize} font={font}
          primitive={tool === 'primitive' || tool === 'gradient' || tool === 'move' || tool === 'path'} overlay={pathPreview ?? movePreview ?? gradientPreview ?? primitivePreview} gradientLine={gradientLine} path={path} pathNode={pathNode}
          singleClick={tool === 'fill' || tool === 'eyedropper'}
          halfBlock={tool === 'draw' && drawMode === 'half'}
          navigating={tool === 'cursor'} onNavigate={navigate} onPoint={point} onEnd={endPointer} onScroll={scroll} onKey={keyDown} onRows={setVisibleRows} />
        <div className="canvas-footer">
          <button onClick={() => scroll(-visibleRows)} aria-label="Scroll up one page">↑ Page</button>
          <span>Rows {top + 1}–{top + visibleRows} <span className="muted">· wheel to scroll</span></span>
          <button onClick={() => scroll(visibleRows)} aria-label="Scroll down one page">↓ Page</button>
        </div>
        <section className="function-palette" aria-label="Function key palette">
          <div className="palette-heading"><h2>Character set</h2><select aria-label="Function key character set" value={palette} onChange={event => setPalette(Number(event.target.value))}>
            {PALETTES.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
          </select><span className="muted">F1–F12 to place</span></div>
          <div className="function-keys">{Array.from({ length: 12 }, (_, index) => {
            const value = PALETTES[palette].codes[index]
            return <button key={index} disabled={value === undefined} aria-pressed={code === value}
              title={value === undefined ? 'Unassigned' : `F${index + 1}: CP437 ${value}`}
              onClick={() => { if (value !== undefined) setCode(value) }}>
              <kbd>F{index + 1}</kbd><span>{value === undefined ? '–'
                : <ShadeGlyph code={value} color={code === value ? '#c4ee86' : '#dce5f1'} font={font} />}</span>
            </button>
          })}</div>
        </section>
        <details className="all-characters"><summary>All characters <span>Printable ASCII + extended CP437 · 224 glyphs</span></summary>
          <div className="character-grid">{CP437.slice(32).map((_glyph, index) => <button key={index + 32}
            aria-label={`CP437 ${index + 32}`} aria-pressed={code === index + 32} title={`CP437 ${index + 32}`}
            onClick={() => setCode(index + 32)}>{index + 32 === 32 || index + 32 === 255 ? '␣'
              : <ShadeGlyph code={index + 32} color={code === index + 32 ? '#c4ee86' : '#cbd4e2'} width={8} height={16} font={font} />}</button>)}</div>
        </details>
      </section>
      <aside className="sidebar">
        {!tundra && <AgentPanel key={`agents-${agentDocument}`} onCommand={(documentId, command) => {
          if (lastPoint.current || primitiveDrag.current || gradientDrag.current || moveDrag.current || pathDraft.current) return { ok: false, error: 'A pointer stroke is in progress. Try again after the user finishes drawing.' }
          const result = executeAgentCommand(editor, documentId, revisionCounter.current, command)
          if (result.ok && command.type === 'draw') {
            refresh()
            setMessage(`Agent drew ${command.input.cells.length} cells. Undo is available.`)
          }
          return result
        }} />}
        {tundra && <p className="color-note">Agent access and Ansimation support classic ANSI documents only.</p>}
        {tundra ? <TundraColors key={`colors-${agentDocument}`} fg={fg} bg={bg} code={code} font={font}
          cells={editor.cells} onFg={setFg} onBg={setBg} onError={report} /> : <section className="panel color-panel">
          <div className="panel-heading"><h2>ANSI colors</h2><span className="badge">16 FG / 8 BG</span></div>
          <div className="ink-preview">
            <div className="sample-cell" style={{ color: colorCss(fg), backgroundColor: colorCss(bg) }}>
              <ShadeGlyph code={code} color={colorCss(fg)} font={font} />
            </div>
            <div><strong>CP437 {code}</strong><span>FG {fg} · BG {bg}</span></div>
            <button title="Swap colors (bright foreground becomes its base background color)" aria-label="Swap foreground and background" onClick={() => {
              setFg(bg); setBg(fg % BACKGROUND_COLORS.length)
              setMessage(fg >= BACKGROUND_COLORS.length ? 'Swapped colors; bright foreground converted to its base color for the eight-color background palette.' : 'Swapped foreground and background.')
            }}>⇄</button>
          </div>
          {(['Foreground', 'Background'] as const).map(label => {
            const active = label === 'Foreground' ? fg : bg
            return <div className="color-section" key={label}>
              <div className="color-label"><span>{label}</span><span>{COLOR_NAMES[active]}</span></div>
              <div className="color-grid">{(label === 'Foreground' ? ANSI_COLORS : BACKGROUND_COLORS).map((color, index) => <button key={color}
                aria-label={`${label} ${COLOR_NAMES[index]}`} aria-pressed={active === index} title={`${index}: ${COLOR_NAMES[index]}`}
                style={{ backgroundColor: color }} onClick={() => label === 'Foreground' ? setFg(index) : setBg(index)}>
                {active === index && <span style={{ color: index === 0 || index === 1 || index === 4 || index === 5 || index === 8 ? '#fff' : '#000' }}>✓</span>}
              </button>)}</div>
            </div>
          })}
          <p className="color-note">Classic BBS colors: 16 foregrounds, 8 backgrounds. Bright backgrounds and blink are not used.</p>
        </section>}
        {showPreview && <VgaPreview key={`preview-${agentDocument}`} editor={editor} revision={revision} cursor={cursor} top={top} font={font}
          scrollingDisabled={!!(pathPreview ?? movePreview ?? gradientPreview ?? primitivePreview)}
          selection={selection} overlay={pathPreview ?? movePreview ?? gradientPreview ?? primitivePreview} gradientLine={gradientLine} onPoint={selectPoint} onScroll={scroll} onKey={keyDown}
          onEnd={(next, moved) => { if (!moved) clearSelection(); move(next) }} />}
        <section className="panel quick-help"><h2>At your fingertips</h2>
          <p><kbd>↑ ↓ ← →</kbd> Move cursor</p><p><kbd>F1–F12</kbd> Place palette character</p>
          <p><kbd>Shift + arrows</kbd> Select a block</p><p><kbd>Ctrl C / V</kbd> Copy / paste block</p>
          <p><kbd>Ctrl ← / →</kbd> Cycle foreground</p><p><kbd>Ctrl ↑ / ↓</kbd> Cycle background</p>
          <p><kbd>Alt + click</kbd> Move cursor without painting, or choose Cursor.</p>
          <p>Click + drag to paint. Type to write text. Focus the canvas for shortcuts.</p>
          <p>{hasNativeSave() ? 'Native saving available. Save As lets you choose any permitted directory.' : 'Download mode. Use Chrome/Edge for native directory picking.'}</p>
        </section>
      </aside>
    </main>
    {ansimation && <AnsimationPanel source={ansimation.source} name={name} top={ansimation.top} onClose={() => {
      setAnsimation(undefined)
      windowHeading.current?.focus()
    }} />}
    <div className="status-area">
      {(error || pathResult.error) && <div role="alert" className="error-banner"><strong>Something needs attention:</strong> {error || pathResult.error}
        {!pathResult.error && <button onClick={() => setError('')} aria-label="Dismiss error">×</button>}</div>}
      <footer className="status-bar">
        <span className="cursor-position" aria-label="Cursor position">COL <strong>{String(cursor.x + 1).padStart(2, '0')}</strong> ROW <strong>{String(cursor.y + 1).padStart(2, '0')}</strong></span>
        <span className="status-message" role="status">{message}</span>
        <span>{selection ? `${selection.right - selection.left + 1} × ${selection.bottom - selection.top + 1} selected` : `${tool.toUpperCase()} MODE`}</span>
      </footer>
    </div>
  </div>
}

import { sgr } from './export'
import { AnsiDecoder } from './import'
import { EMPTY, WIDTH, key, validPoint, validateCell, type Cell } from './model'

export const FRAME_ROWS = 25
export const FRAME_CELLS = WIDTH * FRAME_ROWS
export const MODEM_SPEEDS = [
  { baud: 2400, label: '2.4k' },
  { baud: 9600, label: '9.6k' },
  { baud: 14400, label: '14.4k' },
  { baud: 28800, label: '28.8k' },
  { baud: 56000, label: '56k' },
  { baud: 115200, label: '115.2k' },
] as const
export const EFFECTS = [
  { id: 'wipe', label: 'Wipe', single: 'reveal', description: 'A clean left-to-right reveal.' },
  { id: 'dissolve', label: 'Cross-dissolve', single: 'reveal', description: 'A scattered cell dissolve, keeping every color in the DOS palette.' },
  { id: 'flame', label: 'Flame', single: 'erase', description: 'A flickering CP437 fire burns downward, revealing the layer beneath.' },
  { id: 'bullet-holes', label: 'Bullet holes', single: 'erase', description: 'Variable-sized circular holes punch through the art, with blocks flying outward and clearing before the next impact.' },
  { id: 'eraser-down', label: 'Eraser down', single: 'erase', description: 'A chalky eraser sweeps from top to bottom.' },
  { id: 'eraser-across', label: 'Eraser across', single: 'erase', description: 'A chalky eraser sweeps from left to right.' },
  { id: 'spotlight', label: 'Spotlight', single: 'reveal', description: 'A wandering spotlight explores the art, then opens to reveal it all.' },
  { id: 'blinds', label: 'Venetian blinds', single: 'reveal', description: 'Horizontal shutters open in parallel.' },
  { id: 'radial', label: 'Iris reveal', single: 'reveal', description: 'An expanding oval opens from the center.' },
  { id: 'rain', label: 'Digital rain', single: 'reveal', description: 'Staggered bright columns rain down to uncover the art.' },
  { id: 'neo', label: 'Neo', single: 'reveal', description: 'Sparse trails of light and dark green letters and digits cascade down.' },
  { id: 'checker', label: 'Checkerboard', single: 'reveal', description: 'Alternating tiles pop open in two waves.' },
  { id: 'text-spinner', label: 'Text spinner', single: 'text', description: 'ASCII letters and digits repeat |/-\\|/-\\| three times before appearing, one at a time in reading order.' },
  { id: 'text-slide', label: 'Text slide', single: 'text', description: 'ASCII letters and digits slide in from the right edge, one at a time in reading order.' },
] as const
export type Effect = typeof EFFECTS[number]['id']
export type AnimationFrame = readonly Readonly<Cell>[]
export interface AnimationOptions { effect: Effect; frames: number }
const blank: AnimationFrame = Array.from({ length: FRAME_CELLS }, () => EMPTY)
const same = (a: Readonly<Cell>, b: Readonly<Cell>) => a.code === b.code && a.fg === b.fg && a.bg === b.bg
type TextEffect = Extract<Effect, 'text-spinner' | 'text-slide'>
type CellChange = readonly [number, Readonly<Cell>]
const spinner = Array.from('|/-\\|/-\\|'.repeat(3), char => char.charCodeAt(0))
const isTextEffect = (effect: Effect): effect is TextEffect => effect === 'text-spinner' || effect === 'text-slide'
const isAlphanumeric = ({ code }: Readonly<Cell>) => code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122
const canSlideOver = (cell: Readonly<Cell>) => isAlphanumeric(cell) || cell.code === 32 || cell.code === 255
const letterSteps = (effect: TextEffect, index: number) => effect === 'text-spinner' ? spinner.length + 1 : WIDTH - index % WIDTH
const hiddenText = (source: AnimationFrame): AnimationFrame => source.map(cell => isAlphanumeric(cell) ? { ...cell, code: 32 } : cell)
function textPositions(source: AnimationFrame): number[] {
  const positions: number[] = []
  source.forEach((cell, index) => { if (isAlphanumeric(cell)) positions.push(index) })
  return positions
}

export function captureFrame(cells: ReadonlyMap<string, Cell>, top: number): AnimationFrame {
  if (!validPoint({ x: 0, y: top }) || !validPoint({ x: 79, y: top + FRAME_ROWS - 1 })) {
    throw new Error('The 80x25 frame exceeds safe coordinate precision.')
  }
  return Array.from({ length: FRAME_CELLS }, (_, index) => {
    const cell = cells.get(key(index % WIDTH, top + Math.floor(index / WIDTH))) ?? EMPTY
    validateCell(cell)
    return { ...cell }
  })
}

function validateFrame(frame: AnimationFrame): void {
  if (frame.length !== FRAME_CELLS) throw new Error('Ansimation requires an 80x25 frame.')
  for (const cell of frame) validateCell(cell)
}
export function frameCount(options: AnimationOptions, source?: AnimationFrame): number {
  if (!Number.isInteger(options.frames) || options.frames < 2 || options.frames > 361) {
    throw new Error('Invalid animation frame count: use 2 to 361 frames.')
  }
  if (!EFFECTS.some(effect => effect.id === options.effect)) throw new Error('Unknown ansimation effect.')
  if (options.effect === 'bullet-holes') return bulletHoles.length * 4 + 1
  if (isTextEffect(options.effect)) {
    if (!source) throw new Error('Text effects require a source frame.')
    validateFrame(source)
    const effect = options.effect
    return 1 + textPositions(source).reduce((steps, index) => steps + letterSteps(effect, index), 0)
  }
  return options.frames
}
function noise(x: number, y: number): number {
  let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

const bulletHoles = Array.from({ length: 15 }, (_, index) => ({
  x: (index % 5 + 0.5) * WIDTH / 5,
  y: (Math.floor(index / 5) + 0.5) * FRAME_ROWS / 3,
  radius: 12 + Math.floor(noise(index, 73) * 4),
  order: index === 7 ? -1 : noise(index, 97),
})).sort((a, b) => a.order - b.order)

function bulletFrame(source: AnimationFrame, target: AnimationFrame, progress: number): AnimationFrame {
  const step = Math.floor(progress * bulletHoles.length * 4 + 1e-8)
  if (step === 0) return source
  const impact = Math.min(bulletHoles.length - 1, Math.floor((step - 1) / 4))
  const phase = (step - 1) % 4
  const removed = bulletHoles.slice(0, impact + 1)
  const frame = source.map((cell, index) => {
    const x = index % WIDTH + 0.5, y = Math.floor(index / WIDTH) + 0.5
    return removed.some(hole => Math.hypot(x - hole.x, (y - hole.y) * 2) <= hole.radius) ? target[index] : cell
  })
  if (phase === 3) return frame
  const hole = bulletHoles[impact]
  for (let fragment = 0; fragment < 8; fragment++) {
    const angle = fragment * Math.PI / 4 + (noise(impact, fragment + 161) - 0.5) * 0.18
    const distance = hole.radius - 1 + phase * 6 + noise(impact, fragment + 233)
    const x = Math.floor(hole.x + Math.cos(angle) * distance)
    const y = Math.floor(hole.y + Math.sin(angle) * distance / 2)
    if (x < 0 || x >= WIDTH || y < 0 || y >= FRAME_ROWS) continue
    const rimX = Math.min(WIDTH - 1, Math.max(0, Math.floor(hole.x + Math.cos(angle) * (hole.radius - 1))))
    const rimY = Math.min(FRAME_ROWS - 1, Math.max(0, Math.floor(hole.y + Math.sin(angle) * (hole.radius - 1) / 2)))
    const index = y * WIDTH + x
    frame[index] = { code: phase === 2 ? 254 : 219, fg: source[rimY * WIDTH + rimX].fg, bg: frame[index].bg }
  }
  return frame
}

function textFrame(source: AnimationFrame, effect: TextEffect, progress: number): AnimationFrame {
  const positions = textPositions(source)
  const steps = positions.reduce((sum, index) => sum + letterSteps(effect, index), 0)
  let remaining = Math.floor(progress * steps + 1e-8)
  const frame = [...hiddenText(source)]
  for (const index of positions) {
    const cost = letterSteps(effect, index)
    if (remaining >= cost) {
      frame[index] = source[index]
      remaining -= cost
    } else {
      if (remaining > 0) {
        if (effect === 'text-spinner') frame[index] = { ...source[index], code: spinner[remaining - 1] }
        else {
          const position = Math.floor(index / WIDTH) * WIDTH + WIDTH - remaining
          if (canSlideOver(source[position])) frame[position] = { ...source[index], bg: source[position].bg }
        }
      }
      break
    }
  }
  return frame
}

export function animationFrame(source: AnimationFrame, second: AnimationFrame | undefined, options: AnimationOptions, progress: number): AnimationFrame {
  validateFrame(source)
  if (second) validateFrame(second)
  frameCount(options, source)
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Invalid animation progress.')
  if (isTextEffect(options.effect)) {
    if (second) throw new Error('Text effects use a single ANSI only.')
    return progress === 1 ? source : textFrame(source, options.effect, progress)
  }
  const erasing = EFFECTS.find(effect => effect.id === options.effect)?.single === 'erase'
  const from = second || erasing ? source : blank
  const to = second ?? (erasing ? blank : source)
  if (progress === 0) return from
  if (progress === 1) return to
  if (options.effect === 'bullet-holes') return bulletFrame(from, to, progress)
  return Array.from({ length: FRAME_CELLS }, (_, index) => {
    const x = index % WIDTH, y = Math.floor(index / WIDTH)
    let revealed = false
    switch (options.effect) {
      case 'wipe': revealed = (x + 0.5) / WIDTH < progress; break
      case 'dissolve': revealed = noise(x, y) < progress; break
      case 'flame': {
        const front = progress * (FRAME_ROWS + 6) - 3 + (noise(x, 0) - 0.5) * 3
        const distance = y - front
        if (Math.abs(distance) < 1.5) {
          const flicker = noise(x, y + Math.floor(progress * 72))
          return { code: flicker < 0.3 ? 176 : flicker < 0.6 ? 178 : 219, fg: distance > 0.5 ? 4 : flicker < 0.4 ? 12 : flicker < 0.8 ? 14 : 15, bg: 0 }
        }
        revealed = distance < 0
        break
      }
      case 'eraser-down':
      case 'eraser-across': {
        const position = options.effect === 'eraser-down' ? y : x
        const length = options.effect === 'eraser-down' ? FRAME_ROWS : WIDTH
        const edge = progress * (length + 2) - 1
        if (Math.abs(position - edge) < 0.6) return { code: 177, fg: 15, bg: 7 }
        revealed = position < edge
        break
      }
      case 'spotlight': {
        const opening = Math.max(0, (progress - 0.65) / 0.35)
        const travel = Math.min(progress / 0.65, 1)
        const cx = 40 + Math.sin(travel * Math.PI * 2) * 27 * (1 - travel)
        const cy = 12.5 + Math.cos(travel * Math.PI * 3) * 8 * (1 - travel)
        revealed = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 2) < 9 + opening * 40
        break
      }
      case 'blinds': revealed = (y % 5 + 0.5) / 5 < progress; break
      case 'radial': revealed = Math.hypot(x + 0.5 - 40, (y + 0.5 - 12.5) * 2) < progress * Math.hypot(40, 25); break
      case 'rain': {
        const front = progress * (FRAME_ROWS + 14) - noise(x, 0) * 14
        if (y <= front && y > front - 1) return { code: 219, fg: 10, bg: 0 }
        revealed = y < front
        break
      }
      case 'neo': {
        const head = progress * (FRAME_ROWS + 16) - noise(x, 0) * 8
        const distance = head - y
        const lane = Math.floor(x / 4)
        const rainColumn = lane * 4 + Math.floor(noise(lane, 1) * 4)
        if (x === rainColumn && distance >= 0 && distance < 8) {
          const tick = Math.floor(progress * (options.frames - 1))
          const glyph = Math.floor(noise(x, y + tick * FRAME_ROWS) * 62)
          return {
            code: glyph < 10 ? 48 + glyph : glyph < 36 ? 65 + glyph - 10 : 97 + glyph - 36,
            fg: distance < 1.25 || noise(x + tick, y) > 0.75 ? 10 : 2,
            bg: 0,
          }
        }
        revealed = distance >= 8
        break
      }
      case 'checker': {
        const tileX = Math.floor(x / 4), tileY = Math.floor(y / 2)
        revealed = ((tileX + tileY) % 2 + noise(tileX, tileY)) / 2 < progress
        break
      }
    }
    return revealed ? to[index] : from[index]
  })
}

const control = (text: string) => Array.from(text, char => char.charCodeAt(0))

function* changedCells(frame: AnimationFrame, previous: AnimationFrame): Generator<CellChange> {
  for (let index = 0; index < FRAME_CELLS; index++) {
    if (!same(frame[index], previous[index])) yield [index, frame[index]]
  }
}

function* textChanges(source: AnimationFrame, effect: TextEffect, initial: AnimationFrame): Generator<Iterable<CellChange>> {
  const settled = [...initial]
  yield changedCells(initial, blank)
  for (const index of textPositions(source)) {
    if (effect === 'text-spinner') {
      for (const code of spinner) yield [[index, { ...source[index], code }]]
      yield [[index, source[index]]]
    } else {
      let previous: number | undefined
      for (let x = WIDTH - 1; x >= index % WIDTH; x--) {
        const changes: CellChange[] = []
        if (previous !== undefined) changes.push([previous, settled[previous]])
        const position = Math.floor(index / WIDTH) * WIDTH + x
        if (canSlideOver(source[position])) {
          changes.push([position, { ...source[index], bg: source[position].bg }])
          previous = position
        } else previous = undefined
        yield changes.sort(([a], [b]) => a - b)
      }
    }
    settled[index] = source[index]
  }
}

export function* animationChunks(source: AnimationFrame, second: AnimationFrame | undefined, options: AnimationOptions): Generator<Uint8Array<ArrayBuffer>> {
  const count = frameCount(options, source)
  let previous: AnimationFrame = blank
  let color: Readonly<Cell> = EMPTY
  const encode = (changes: Iterable<CellChange>) => {
    const bytes: number[] = []
    let lastIndex = -2
    for (const [index, cell] of changes) {
      if (index !== lastIndex + 1 || index % WIDTH === 0) {
        bytes.push(...control(`\x1b[${Math.floor(index / WIDTH) + 1};${index % WIDTH + 1}H`))
      }
      if (cell.fg !== color.fg || cell.bg !== color.bg) bytes.push(...sgr(cell, true))
      bytes.push(cell.code)
      color = cell
      lastIndex = index
    }
    return new Uint8Array(bytes)
  }
  // Cursor addressing, with no LF or printable byte after column 80, avoids bottom-row scrolling.
  const first = animationFrame(source, second, options, 0)
  yield new Uint8Array(control('\x1b[0m\x1b[2J\x1b[H'))
  if (isTextEffect(options.effect)) {
    // Mandatory letter steps stream sparse changes, rather than storing or rescanning thousands of full frames.
    for (const changes of textChanges(source, options.effect, first)) yield encode(changes)
  } else {
    for (let step = 0; step < count; step++) {
      const frame = step === 0 ? first : animationFrame(source, second, options, step / (count - 1))
      yield encode(changedCells(frame, previous))
      previous = frame
    }
  }
  yield new Uint8Array(control('\x1b[0m\x1b[25;1H'))
}

export class AnsiPlayback {
  private decoder = new AnsiDecoder()
  private iterator: Iterator<Uint8Array<ArrayBuffer>>
  private chunk = new Uint8Array()
  private offset = 0
  private budget = 0
  transmittedBytes = 0
  complete = false
  constructor(source: Iterable<Uint8Array<ArrayBuffer>>, private baud: number) {
    if (!MODEM_SPEEDS.some(speed => speed.baud === baud)) throw new Error('Unsupported modem speed.')
    this.iterator = source[Symbol.iterator]()
  }
  advance(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid playback elapsed time.')
    // Approximate serial 8N1: eight data bits plus start and stop, no modem compression.
    this.budget += elapsedMs * this.baud / 10000
    while (!this.complete) {
      if (this.offset === this.chunk.length) {
        const next = this.iterator.next()
        if (next.done) { this.decoder.finish(); this.complete = true; break }
        this.chunk = next.value
        this.offset = 0
        if (!this.chunk.length) continue
      }
      const count = Math.min(Math.floor(this.budget), this.chunk.length - this.offset)
      if (!count) break
      this.decoder.write(this.chunk.subarray(this.offset, this.offset + count))
      this.offset += count
      this.transmittedBytes += count
      this.budget -= count
    }
  }
  frame(): AnimationFrame { return captureFrame(this.decoder.screen, 0) }
}

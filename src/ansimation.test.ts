import { describe, expect, it } from 'vitest'
import { AnsiDecoder } from './import'
import { Editor, EMPTY, key } from './model'
import { EFFECTS, FRAME_CELLS, FRAME_ROWS, AnsiPlayback, animationChunks, animationFrame, captureFrame, frameCount, type AnimationOptions } from './ansimation'

const art = captureFrame(new Editor(new Map([
  ['0,0', { code: 219, fg: 14, bg: 1 }],
  ['79,24', { code: 255, fg: 15, bg: 7 }],
])).cells, 0)
const target = captureFrame(new Editor(new Map([
  ['1,0', { code: 178, fg: 9, bg: 2 }],
  ['79,24', { code: 32, fg: 3, bg: 1 }],
])).cells, 0)
const blank = Array.from({ length: FRAME_CELLS }, () => EMPTY)
const options = (effect: AnimationOptions['effect']): AnimationOptions => ({ effect, frames: 37 })

describe('bounded ansimation frames', () => {
  it('captures just 80x25 cells at billion-row coordinates without changing the document', () => {
    const editor = new Editor(new Map([
      ['2,1000000000', { code: 219, fg: 14, bg: 0 }],
      ['3,1000000024', { code: 32, fg: 3, bg: 1 }],
      ['4,1000000025', { code: 65, fg: 7, bg: 0 }],
    ]))
    const snapshot = captureFrame(editor.cells, 1000000000)
    expect(snapshot).toHaveLength(2000)
    expect(snapshot[2]).toEqual({ code: 219, fg: 14, bg: 0 })
    expect(snapshot[24 * 80 + 3]).toEqual({ code: 32, fg: 3, bg: 1 })
    editor.paint({ x: 2, y: 1000000000 }, EMPTY)
    expect(snapshot[2].code).toBe(219)
    expect(editor.canUndo).toBe(false)
    expect(() => captureFrame(editor.cells, Number.MAX_SAFE_INTEGER - 24)).toThrow(/coordinate/)
    expect(() => captureFrame(editor.cells, -1)).toThrow(/coordinate/)
  })
  it.each(EFFECTS.filter(effect => effect.single !== 'text'))('$label has exact two-art endpoints and valid, deterministic intermediate cells', ({ id }) => {
    const settings = options(id)
    expect(animationFrame(art, target, settings, 0)).toEqual(art)
    expect(animationFrame(art, target, settings, 1)).toEqual(target)
    for (const progress of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const frame = animationFrame(art, target, settings, progress)
      expect(frame).toHaveLength(FRAME_CELLS)
      expect(frame).toEqual(animationFrame(art, target, settings, progress))
      expect(() => new Editor(new Map(frame.map((cell, index) => [key(index % 80, Math.floor(index / 80)), cell])))).not.toThrow()
    }
  })
  it.each(EFFECTS)('$label uses reveal or erase endpoints for single art', ({ id, single }) => {
    expect(animationFrame(art, undefined, options(id), 0)).toEqual(single === 'erase' || single === 'text' ? art : blank)
    expect(animationFrame(art, undefined, options(id), 1)).toEqual(single === 'erase' ? blank : art)
  })
  it('wipes from left to right and dissolves monotonically using whole CP437 cells', () => {
    const from = Array.from({ length: FRAME_CELLS }, () => ({ code: 65, fg: 7, bg: 0 }))
    const to = Array.from({ length: FRAME_CELLS }, () => ({ code: 219, fg: 14, bg: 1 }))
    const wipe = animationFrame(from, to, options('wipe'), 0.5)
    expect(wipe[39]).toEqual(to[39])
    expect(wipe[40]).toEqual(from[40])
    const early = animationFrame(from, to, options('dissolve'), 0.25)
    const late = animationFrame(from, to, options('dissolve'), 0.75)
    expect(early.filter(cell => cell.code === 219).length).toBeGreaterThan(400)
    expect(early.filter(cell => cell.code === 219).length).toBeLessThan(600)
    early.forEach((cell, index) => { if (cell.code === 219) expect(late[index].code).toBe(219) })
  })
  it('rejects malformed frames, controls, colors, effects, frame counts and progress', () => {
    expect(() => animationFrame([], target, options('wipe'), 0)).toThrow(/80/)
    expect(() => animationFrame(art, [], options('wipe'), 0)).toThrow(/80/)
    for (const cell of [{ code: 27, fg: 7, bg: 0 }, { code: 219, fg: 16, bg: 0 }, { code: 219, fg: 7, bg: 8 }]) {
      expect(() => animationFrame([cell, ...art.slice(1)], target, options('wipe'), 0)).toThrow(/Invalid cell/)
    }
    // @ts-expect-error Exercise runtime validation of an invalid effect.
    expect(() => animationFrame(art, target, { effect: 'unknown', frames: 37 }, 0)).toThrow(/effect/)
    expect(frameCount({ effect: 'wipe', frames: 2 })).toBe(2)
    expect(frameCount({ effect: 'wipe', frames: 361 })).toBe(361)
    for (const frames of [0, -1, 0.5, 1, 362, NaN, Infinity]) {
      expect(() => frameCount({ effect: 'wipe', frames })).toThrow(/frame count/)
    }
    for (const progress of [-1, 1.1, NaN, Infinity]) {
      expect(() => animationFrame(art, target, options('wipe'), progress)).toThrow(/progress/)
    }
  })
})

describe('animated ANSI byte stream', () => {
  it.each(EFFECTS)('$label decodes every exported frame to the exact preview including the bottom-right cell', ({ id }) => {
    const settings = { effect: id, frames: 13 }
    const decoder = new AnsiDecoder()
    const textOnly = EFFECTS.find(effect => effect.id === id)?.single === 'text'
    const second = textOnly ? undefined : target
    const chunks = [...animationChunks(art, second, settings)]
    expect(chunks).toHaveLength(frameCount(settings, art) + 2)
    chunks.forEach((chunk, index) => {
      expect(chunk.byteLength).toBeLessThan(64 * 1024)
      expect(chunk).not.toContain(10)
      expect(chunk).not.toContain(13)
      decoder.write(chunk)
      if (index > 0 && index < chunks.length - 1) {
        const count = frameCount(settings, art)
        const expected = animationFrame(art, second, settings, count === 1 ? 0 : (index - 1) / (count - 1))
        expect(captureFrame(decoder.finish(), 0)).toEqual(expected)
      }
    })

    expect(chunks[0]).toEqual(new Uint8Array([27, 91, 48, 109, 27, 91, 50, 74, 27, 91, 72]))
    expect(chunks.at(-1)).toEqual(new Uint8Array([27, 91, 48, 109, 27, 91, 50, 53, 59, 49, 72]))
    expect(captureFrame(decoder.finish(), 0)).toEqual(second ?? art)
  })

  describe('sequential bullet holes', () => {
      const from = Array.from({ length: FRAME_CELLS }, () => ({ code: 65, fg: 14, bg: 1 }))
      const to = Array.from({ length: FRAME_CELLS }, () => ({ code: 66, fg: 9, bg: 2 }))
      const settings = options('bullet-holes')
      const at = (step: number) => animationFrame(from, to, settings, step / 60)
      const centers = Array.from({ length: 15 }, (_, index) => ({
        x: (index % 5 + 0.5) * 16,
        y: (Math.floor(index / 5) + 0.5) * 25 / 3,
      }))

      it('uses automatic impact, flight and cleanup steps regardless of frame detail', () => {
        for (const frames of [13, 37, 73]) expect(frameCount({ effect: 'bullet-holes', frames }, from)).toBe(61)
        expect(at(0)).toEqual(from)
        expect(at(60)).toEqual(to)
        expect(animationFrame(from, undefined, settings, 1)).toEqual(blank)
      })
      it('removes variable-sized aspect-correct circles one at a time, preserving earlier holes', () => {
        let previous = at(0)
        const radii = new Set<number>()
        for (let impact = 0; impact < 15; impact++) {
          const frame = at((impact + 1) * 4)
          const newCenters = centers.filter(({ x, y }) => {
            const index = Math.floor(y) * 80 + Math.floor(x)
            return previous[index].code === 65 && frame[index].code === 66
          })
          expect(newCenters).toHaveLength(1)
          const center = newCenters[0]
          const radius = [12, 13, 14, 15].find(size => frame.every((cell, index) => {
            const distance = Math.hypot(index % 80 + 0.5 - center.x, (Math.floor(index / 80) + 0.5 - center.y) * 2)
            return cell.code === (previous[index].code === 66 || distance <= size ? 66 : 65)
          }))
          expect(radius).toBeDefined()
          radii.add(radius!)
          frame.forEach((cell, index) => expect(cell).toEqual(cell.code === 66 ? to[index] : from[index]))
          expect(frame.filter(cell => cell.code === 66).length).toBeGreaterThan(previous.filter(cell => cell.code === 66).length)
          previous = frame
        }
        expect(radii.size).toBeGreaterThan(1)
        expect(previous).toEqual(to)
      })
      it('throws blocks outward, shrinks them and clears them before the next impact', () => {
        const distances = [1, 2, 3].map(step => {
          const frame = at(step)
          const fragments = frame.flatMap((cell, index) => [219, 254].includes(cell.code) ? [{ cell, index }] : [])
          expect(fragments.length).toBeGreaterThanOrEqual(4)
          expect(fragments.every(({ cell }) => cell.code === (step === 3 ? 254 : 219) && cell.fg === 14)).toBe(true)
          return fragments.reduce((sum, { index }) => sum + Math.hypot(index % 80 + 0.5 - 40, (Math.floor(index / 80) + 0.5 - 12.5) * 2), 0) / fragments.length
        })
        expect(distances[1]).toBeGreaterThan(distances[0] + 2)
        expect(distances[2]).toBeGreaterThan(distances[1] + 2)
        expect(at(4).every(cell => cell.code === 65 || cell.code === 66)).toBe(true)
        expect(at(5).some(cell => cell.code === 219)).toBe(true)
        const cleared = at(4)
        for (const step of [1, 2, 3]) {
          at(step).forEach((cell, index) => { if (cell.code === 66) expect(cleared[index].code).toBe(66) })
        }
      })
      it('finishes revealing all art before the final debris disappears, without a last-frame hard cut', () => {
        expect(at(59).some(cell => cell.code === 65)).toBe(false)
        expect(at(60)).toEqual(to)
        for (let step = 0; step <= 60; step++) {
          const frame = at(step)
          expect(frame).toHaveLength(2000)
          expect(() => new Editor(new Map(frame.map((cell, index) => [key(index % 80, Math.floor(index / 80)), cell])))).not.toThrow()
        }
      })
      it('exports each hole and debris step as the exact preview screen', () => {
        const decoder = new AnsiDecoder()
        const chunks = [...animationChunks(from, to, settings)]
        expect(chunks).toHaveLength(63)
        for (let index = 0; index < chunks.length; index++) {
          const chunk = chunks[index]
          expect(chunk).not.toContain(10)
          expect(chunk).not.toContain(13)
          expect(chunk.byteLength).toBeLessThan(64 * 1024)
          decoder.write(chunk)
          if (index > 0 && index < 62) expect(captureFrame(decoder.finish(), 0)).toEqual(at(index - 1))
        }
      })
    })

  it('exports binary CP437 and classic bold bright colors rather than UTF-8 or bright backgrounds', () => {
    const bytes = [...animationChunks(art, undefined, options('wipe'))].flatMap(chunk => [...chunk])
    expect(bytes).toContain(219)
    expect(bytes).toContain(255)
    const text = String.fromCharCode(...bytes)
    expect(text).toContain('\x1b[0;1;33;44m')
    expect(text).not.toContain('\x1b[9')
    expect(text).not.toContain('\x1b[10')
    expect(FRAME_ROWS).toBe(25)
  })
})

describe('modem-speed playback', () => {
  it.each([14400, 28800, 56000])('transmits exactly %i bits/sec using ten bits per byte, including split controls', baud => {
    const bytes = new Uint8Array(Array.from({ length: 3000 }, () => [27, 91, 72, 65]).flat())
    const playback = new AnsiPlayback([bytes], baud)
    playback.advance(1000)
    expect(playback.transmittedBytes).toBe(baud / 10)
    expect(playback.complete).toBe(false)
  })

  const textArt = captureFrame(new Editor(new Map([
    ['2,0', { code: 65, fg: 14, bg: 1 }],
    ['5,0', { code: 122, fg: 11, bg: 2 }],
    ['1,1', { code: 57, fg: 12, bg: 3 }],
    ['79,0', { code: 179, fg: 3, bg: 4 }],
    ['78,0', { code: 46, fg: 4, bg: 2 }],
    ['77,0', { code: 32, fg: 7, bg: 5 }],
    ['76,0', { code: 130, fg: 14, bg: 1 }],
    ['75,0', { code: 224, fg: 15, bg: 3 }],
    ['74,0', { code: 178, fg: 2, bg: 1 }],
  ])).cells, 0)
  const textPositions = [2, 5, 81]

  describe('Neo and sequential ASCII text effects', () => {
    it('Neo rains deterministic ASCII letters/digits in both light and dark green, then reveals the original', () => {
      const frame = animationFrame(blank, undefined, options('neo'), 0.5)
      const rain = frame.filter(cell => cell.code !== 32)
      expect(rain).toHaveLength(160)
      const columns = new Set(frame.flatMap((cell, index) => cell.code === 32 ? [] : [index % 80]))
      expect(columns.size).toBe(20)
      for (let lane = 0; lane < 20; lane++) {
        expect([...columns].filter(column => Math.floor(column / 4) === lane)).toHaveLength(1)
      }
      expect(new Set(rain.map(cell => cell.fg))).toEqual(new Set([2, 10]))
      expect(rain.every(cell => /^[A-Za-z0-9]$/.test(String.fromCharCode(cell.code)) && cell.bg === 0)).toBe(true)
      expect(frame).toEqual(animationFrame(blank, undefined, options('neo'), 0.5))
      expect(animationFrame(textArt, undefined, options('neo'), 1)).toEqual(textArt)
    })
    it('Neo keeps at most twenty rain columns throughout the transition', () => {
      for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const frame = animationFrame(blank, blank, options('neo'), progress)
        const columns = new Set(frame.flatMap((cell, index) => cell.code === 32 ? [] : [index % 80]))
        expect(columns.size).toBeGreaterThan(0)
        expect(columns.size).toBeLessThanOrEqual(20)
      }
    })
    it.each(['text-spinner', 'text-slide'] as const)('%s hides only ASCII alphanumerics and rejects a second art', effect => {
      const initial = animationFrame(textArt, undefined, options(effect), 0)
      initial.forEach((cell, index) => {
        expect(cell).toEqual(textPositions.includes(index) ? { ...textArt[index], code: 32 } : textArt[index])
      })
      expect(animationFrame(textArt, undefined, options(effect), 1)).toEqual(textArt)
      expect(() => animationFrame(textArt, art, options(effect), 0.5)).toThrow(/single ANSI/)
      expect(() => frameCount(options(effect))).toThrow(/source/)
    })
    it('Spinner repeats the exact nine-character sequence three times before each letter, even on Quick detail', () => {
      const settings = { effect: 'text-spinner', frames: 13 } as const
      expect(frameCount(settings, textArt)).toBe(85)
      const sequence = '|/-\\|/-\\|'.repeat(3)
      for (let letter = 0; letter < textPositions.length; letter++) {
        for (let phase = 1; phase <= 28; phase++) {
          const step = letter * 28 + phase
          const frame = animationFrame(textArt, undefined, settings, step / 84)
          const current = textPositions[letter]
          expect(frame[current]).toEqual({ ...textArt[current], code: phase === 28 ? textArt[current].code : sequence.charCodeAt(phase - 1) })
          textPositions.forEach((index, rank) => {
            if (rank < letter) expect(frame[index]).toEqual(textArt[index])
            if (rank > letter) expect(frame[index].code).toBe(32)
          })
          frame.forEach((cell, index) => { if (!textPositions.includes(index)) expect(cell).toEqual(textArt[index]) })
        }
      }
    })
    it('Spinner remains in motion after half a second at 2.4k before revealing a character', () => {
      const source = captureFrame(new Editor(new Map([['2,0', { code: 65, fg: 14, bg: 1 }]])).cells, 0)
      const playback = new AnsiPlayback(animationChunks(source, undefined, options('text-spinner')), 2400)
      playback.advance(500)
      expect(playback.complete).toBe(false)
      expect(playback.frame()[2].code).not.toBe(65)
      playback.advance(5000)
      expect(playback.complete).toBe(true)
      expect(playback.frame()).toEqual(source)
    })
    it('Slide traverses right-to-left, hides behind decorations, preserves backgrounds, and settles one letter at a time', () => {
      const settings = options('text-slide')
      const count = frameCount(settings, textArt)
      expect(count).toBe(1 + 78 + 75 + 79)
      const at = (step: number) => animationFrame(textArt, undefined, settings, step / (count - 1))
      expect(at(1)[79]).toEqual(textArt[79])
      expect(at(2)[78]).toEqual(textArt[78])
      expect(at(3)[77]).toEqual({ code: 65, fg: 14, bg: 5 })
      expect(at(4)[77]).toEqual(textArt[77])
      expect(at(4)[76]).toEqual(textArt[76])
      expect(at(78)[2]).toEqual(textArt[2])
      expect(at(78)[5].code).toBe(32)
      expect(at(79)[2]).toEqual(textArt[2])
      expect(at(79)[79]).toEqual(textArt[79])
      expect(at(78 + 75)[5]).toEqual(textArt[5])
      expect(at(78 + 75)[81].code).toBe(32)
      for (let step = 0; step < count; step++) {
        const frame = at(step)
        frame.forEach((cell, index) => {
          expect(cell.bg).toBe(textArt[index].bg)
          if (![32, 255].includes(textArt[index].code) && !textPositions.includes(index)) expect(cell).toEqual(textArt[index])
        })
      }
    })
    it.each(['text-spinner', 'text-slide'] as const)('%s exports every mandatory step exactly as preview without accumulating frames', effect => {
      const settings = { effect, frames: 13 }
      const decoder = new AnsiDecoder()
      const count = frameCount(settings, textArt)
      let step = -1
      for (const chunk of animationChunks(textArt, undefined, settings)) {
        decoder.write(chunk)
        expect(chunk.byteLength).toBeLessThan(64 * 1024)
        expect(chunk).not.toContain(10)
        expect(chunk).not.toContain(13)
        if (step >= 0 && step < count) expect(captureFrame(decoder.finish(), 0)).toEqual(animationFrame(textArt, undefined, settings, step / (count - 1)))
        step++
      }
      expect(step).toBe(count + 1)
      expect(captureFrame(decoder.finish(), 0)).toEqual(textArt)
      expect(frameCount({ effect, frames: 73 }, textArt)).toBe(count)
    })
    it('handles all 2000 text cells with automatic step counts beyond the generic frame-detail limit', () => {
      const dense = Array.from({ length: 2000 }, () => ({ code: 65, fg: 15, bg: 1 }))
      expect(frameCount(options('text-spinner'), dense)).toBe(56001)
      expect(frameCount(options('text-slide'), dense)).toBe(81001)
      const iterator = animationChunks(dense, undefined, options('text-slide'))
      expect(iterator.next().value?.byteLength).toBeLessThan(64 * 1024)
      expect(iterator.next().value?.byteLength).toBeLessThan(64 * 1024)
      expect(iterator.next().value?.byteLength).toBeLessThan(64)
      iterator.return(undefined)
      expect(frameCount(options('text-spinner'), art)).toBe(1)
    })
    it.each(['text-spinner', 'text-slide'] as const)('%s completes a fully populated screen using bounded sparse step chunks', effect => {
      const dense = Array.from({ length: 2000 }, () => ({ code: 65, fg: 15, bg: 1 }))
      const settings = options(effect)
      const decoder = new AnsiDecoder()
      let chunks = 0, bytes = 0
      for (const chunk of animationChunks(dense, undefined, settings)) {
        chunks++
        bytes += chunk.byteLength
        expect(chunk.byteLength).toBeLessThan(chunks === 2 ? 64 * 1024 : 64)
        decoder.write(chunk)
      }
      expect(chunks).toBe(frameCount(settings, dense) + 2)
      expect(bytes).toBeLessThan(64 * 1024 * 1024)
      expect(captureFrame(decoder.finish(), 0)).toEqual(dense)
    })
  })
  it('preserves fractional byte budgets and decodes escape sequences split across ticks', () => {
    const playback = new AnsiPlayback(animationChunks(art, target, { effect: 'wipe', frames: 13 }), 14400)
    for (let tick = 0; tick < 10; tick++) playback.advance(0.1)
    expect(playback.transmittedBytes).toBe(1)
    expect(playback.frame()).toHaveLength(2000)
    playback.advance(100000)
    expect(playback.complete).toBe(true)
    expect(playback.frame()).toEqual(target)
  })
  it('rejects unsupported speeds and invalid elapsed time', () => {
    expect(() => new AnsiPlayback([], 0)).toThrow(/speed/)
    const playback = new AnsiPlayback([], 14400)
    expect(() => playback.advance(-1)).toThrow(/elapsed/)
    expect(() => playback.advance(Infinity)).toThrow(/elapsed/)
  })
})

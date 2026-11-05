import { describe, expect, it } from 'vitest'
import { Editor, MAX_ROW, pointFromKey } from './model'
import { rgbColor } from './colors'
import { ansiChunks } from './export'
import { appendPathNode, constrainPathPoint, convertPathNode, hitPathSegment, insertPathNode, linkPathHandles, movePathHandle, pathContainsPoint, rasterizePath, removePathNode, translatePath, type BezierPath, type PathNode } from './path'

const node = (x: number, y: number): PathNode => ({
  point: { x, y }, incoming: { x, y }, outgoing: { x, y },
})
const box = (left: number, top: number, right: number, bottom: number, origin = 0): BezierPath => ({
  origin, closed: true, nodes: [node(left, top), node(right, top), node(right, bottom), node(left, bottom)],
})
const ink = { fg: 14, bg: 0 }

describe('path axis constraints', () => {
  it('chooses the nearest axis in VGA proportions, including reverse and fractional positions', () => {
    const origin = { x: 5, y: 3 }
    expect(constrainPathPoint({ x: 15, y: 6 }, origin)).toEqual({ x: 15, y: 3 })
    expect(constrainPathPoint({ x: 9, y: 6 }, origin)).toEqual({ x: 5, y: 6 })
    expect(constrainPathPoint({ x: 9, y: 5 }, origin)).toEqual({ x: 9, y: 3 })
    expect(constrainPathPoint({ x: 1, y: 2.5 }, origin)).toEqual({ x: 1, y: 3 })
    expect(constrainPathPoint({ x: 5.25, y: 1.5 }, origin)).toEqual({ x: 5, y: 1.5 })
    expect(() => constrainPathPoint({ x: NaN, y: 0 }, origin)).toThrow(/finite/)
  })
  it('appends a straight constrained segment without changing earlier curves or its source', () => {
    const previous = { point: { x: 5, y: 3 }, incoming: { x: 2, y: 2 }, outgoing: { x: 8, y: 4 }, linked: true }
    const source = { origin: MAX_ROW - 20, closed: false, nodes: [previous] }
    const before = structuredClone(source)
    const result = appendPathNode(source, { x: 15, y: 6 }, true, { x: 17, y: 8 })
    expect(result.origin).toBe(source.origin)
    expect(result.nodes[0]).toEqual({ ...previous, outgoing: previous.point, linked: false })
    expect(result.nodes[1].point).toEqual({ x: 15, y: 3 })
    expect(result.nodes[1].incoming).toEqual(result.nodes[1].point)
    expect(result.nodes[1].outgoing).toEqual({ x: 15, y: 5 })
    const clicked = appendPathNode(source, { x: 15, y: 6 }, true)
    expect(clicked.nodes[1].outgoing).toEqual(clicked.nodes[1].point)
    const distant = appendPathNode({ origin: 0, closed: false, nodes: [node(5, MAX_ROW - 2)] },
      { x: 10, y: MAX_ROW - 1 }, true).nodes[1]
    expect(distant.point).toEqual({ x: 10, y: MAX_ROW - 2 })
    expect(distant.outgoing).toEqual(distant.point)
    expect(source).toEqual(before)
  })
  it('keeps unconstrained click-drag handles mirrored and constrains first-node handles without a predecessor', () => {
    const path = { origin: 0, closed: false, nodes: [] }
    const free = appendPathNode(path, { x: 5, y: 3 }, false, { x: 8, y: 4 })
    expect(free.nodes[0].outgoing).toEqual({ x: 8, y: 4 })
    expect(free.nodes[0].incoming).toEqual({ x: 2, y: 2 })
    const snapped = appendPathNode(path, { x: 5, y: 3 }, true, { x: 8, y: 4 })
    expect(snapped.nodes[0].outgoing).toEqual({ x: 8, y: 3 })
    expect(snapped.nodes[0].incoming).toEqual({ x: 2, y: 3 })
    const distant = appendPathNode(path, { x: 5, y: MAX_ROW - 2 }, false, { x: 8, y: MAX_ROW - 1 }).nodes[0]
    expect(distant.incoming).toEqual({ x: 2, y: MAX_ROW - 3 })
    expect(() => appendPathNode(box(0, 0, 2, 2), { x: 5, y: 5 })).toThrow(/closed/)
    expect(() => appendPathNode(path, { x: 5, y: 5 }, false, { x: Infinity, y: 5 })).toThrow(/finite/)
  })
})

describe('Bezier path rasterization', () => {
  it('inserts on straight, curved and closing segments without changing their geometry', () => {
    for (const index of [0, 3]) {
      const path = convertPathNode(box(5, 5, 15, 15, 1_000_000_000), index, true)
      const before = structuredClone(path)
      const inserted = insertPathNode(path, index, 0.5)
      const hit = hitPathSegment(path, inserted.nodes[index + 1].point, { x: 0.01, y: 0.01 })
      expect(hit?.index).toBe(index)
      expect(hit?.t).toBeCloseTo(0.5, 5)
      expect(rasterizePath(inserted, ink)).toEqual(rasterizePath(path, ink))
      expect(path).toEqual(before)
    }
    const path = box(5, 5, 15, 15)
    expect(insertPathNode(path, 0, 0.5).nodes[1].point).toEqual({ x: 10, y: 5 })
    expect(hitPathSegment(path, { x: 10, y: 10 }, { x: 0.5, y: 0.25 })).toBeUndefined()
    expect(() => insertPathNode({ ...path, closed: false }, 3, 0.5)).toThrow(/segment/)
    expect(() => insertPathNode(path, 0, 0)).toThrow(/segment/)
  })

  it('moves the whole path with its handles, clamps anchors at edges and retains distant local precision', () => {
    const path = convertPathNode(box(5, 0, 15, 10, MAX_ROW - 10), 1, true)
    const shifted = translatePath(path, { x: -20, y: 100 })
    expect(shifted.nodes[0].point).toEqual({ x: 0, y: 0 })
    expect(shifted.nodes[1].incoming.x).toBeCloseTo(path.nodes[1].incoming.x - 5)
    expect(shifted.origin).toBe(path.origin)
    expect(pathContainsPoint(path, { x: 10, y: 5 })).toBe(true)
    expect(pathContainsPoint(path, { x: 30, y: 5 })).toBe(false)
    expect(pathContainsPoint({ ...path, closed: false }, { x: 10, y: 5 })).toBe(false)
    expect(() => translatePath(path, { x: NaN, y: 0 })).toThrow(/finite/)
  })

  it('optionally keeps opposite handles collinear with independent lengths in either direction', () => {
    const path = box(5, 5, 15, 15)
    path.nodes[0] = { point: { x: 5, y: 5 }, incoming: { x: 3, y: 5 }, outgoing: { x: 9, y: 5 } }
    const linked = linkPathHandles(path, 0, true).nodes[0]
    const moved = movePathHandle(linked, 'outgoing', { x: 5, y: 7 })
    expect(moved.incoming).toEqual({ x: 5, y: 4 })
    expect(movePathHandle(moved, 'incoming', { x: 3, y: 5 }).outgoing).toEqual({ x: 9, y: 5 })
    expect(movePathHandle(path.nodes[0], 'outgoing', { x: 5, y: 7 }).incoming).toEqual({ x: 3, y: 5 })
    expect(movePathHandle(linked, 'outgoing', linked.point).incoming).toEqual(linked.point)
    const anchorOnly = linkPathHandles(path, 1, true).nodes[1]
    expect(movePathHandle(anchorOnly, 'outgoing', { x: 17, y: 5 }).incoming).toEqual({ x: 13, y: 5 })
  })

  it('deletes any node, preserves closure when possible, and reopens undersized paths', () => {
    const path = box(2, 2, 8, 8)
    const result = removePathNode(path, 1)
    expect(result.nodes.map(node => node.point)).toEqual([{ x: 2, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }])
    expect(result.closed).toBe(true)
    expect(removePathNode(result, 0).closed).toBe(false)
    expect(path.nodes).toHaveLength(4)
    expect(() => removePathNode(path, -1)).toThrow(/Select/)
    expect(() => removePathNode(path, 4)).toThrow(/Select/)
  })

  it('converts corners into mirrored smooth handles and back without moving anchors', () => {
    const path = box(2, 2, 8, 8, 1_000_000_000)
    const curve = convertPathNode(path, 1, true)
    const node = curve.nodes[1]
    expect(node.point).toEqual(path.nodes[1].point)
    expect(node.incoming).not.toEqual(node.point)
    expect(node.outgoing).not.toEqual(node.point)
    expect(node.incoming.x + node.outgoing.x).toBeCloseTo(2 * node.point.x)
    expect(node.incoming.y + node.outgoing.y).toBeCloseTo(2 * node.point.y)
    expect(curve.closed).toBe(true)
    expect(convertPathNode(curve, 1, false)).toEqual(path)
    expect(path.nodes[1].outgoing).toEqual(path.nodes[1].point)
    expect(() => convertPathNode(path, 1.5, true)).toThrow(/Select/)
    const top = convertPathNode(box(0, 0, 4, 4), 1, true)
    expect([...rasterizePath(top, ink).keys()].every(id => pointFromKey(id).y >= 0)).toBe(true)
  })

  it('exports fitted halves as binary CP437 with exact reset and line-feed bytes', () => {
    const cells = rasterizePath(box(0, 0, 2, 0.5), { fg: 7, bg: 0 })
    const reset = [27, 91, 48, 109]
    expect([...ansiChunks(cells)].flatMap(chunk => [...chunk])).toEqual([
      ...reset, 27, 91, 50, 74, 27, 91, 72, 223, 223, ...reset, 13, 10, ...reset,
    ])
  })
  it('fits exact full, horizontal half and vertical half blocks', () => {
    expect(rasterizePath(box(2, 3, 4, 4), ink)).toEqual(new Map([
      ['2,3', { code: 219, ...ink }], ['3,3', { code: 219, ...ink }],
    ]))
    expect(rasterizePath(box(2, 3, 3, 3.5), ink).get('2,3')?.code).toBe(223)
    expect(rasterizePath(box(2, 3.5, 3, 4), ink).get('2,3')?.code).toBe(220)
    expect(rasterizePath(box(2, 3, 2.5, 4), ink).get('2,3')?.code).toBe(221)
    expect(rasterizePath(box(2.5, 3, 3, 4), ink).get('2,3')?.code).toBe(222)
  })

  it('uses cubic handles, including the closing segment, without mutating the draft', () => {
    const straight = box(10, 4, 20, 12)
    const curved = structuredClone(straight)
    curved.nodes[0].outgoing = { x: 10, y: 0 }
    curved.nodes[1].incoming = { x: 20, y: 0 }
    curved.nodes[3].outgoing = { x: 3, y: 12 }
    curved.nodes[0].incoming = { x: 3, y: 4 }
    const before = structuredClone(curved)
    const result = rasterizePath(curved, ink)
    expect(result.has('15,1')).toBe(true)
    expect(result.has('5,8')).toBe(true)
    expect(result.size).toBeGreaterThan(rasterizePath(straight, ink).size)
    expect(curved).toEqual(before)
  })

  it('keeps local subcell precision at billion-row and near-limit coordinates', () => {
    for (const origin of [1_000_000_000, MAX_ROW - 1]) {
      expect(rasterizePath(box(2, 0, 3, 0.5, origin), ink)).toEqual(new Map([
        [`2,${origin}`, { code: 223, ...ink }],
      ]))
    }
  })

  it('subtracts sparsely, preserves surviving inks, and uses the selected hole background', () => {
    const source = new Map([
      ['2,1000000000', { code: 219, fg: 12, bg: 1 }],
      ['3,1000000000', { code: 219, fg: 10, bg: 1 }],
      ['79,0', { code: 65, fg: 7, bg: 0 }],
    ])
    const before = structuredClone(source)
    expect(rasterizePath(box(2, 0, 4, 0.5, 1_000_000_000), { fg: 7, bg: 1 }, source)).toEqual(new Map([
      ['2,1000000000', { code: 220, fg: 12, bg: 1 }],
      ['3,1000000000', { code: 220, fg: 10, bg: 1 }],
    ]))
    expect(source).toEqual(before)
    expect(rasterizePath(box(2, 0, 4, 1, 1_000_000_000), { fg: 7, bg: 0 }, source).get('2,1000000000'))
      .toEqual({ code: 32, fg: 7, bg: 0 })
    expect(rasterizePath(box(2, 0, 4, 1), ink, new Map()).size).toBe(0)
    expect(rasterizePath(box(2, 0, 4, 1_000_000_001), ink, source).size).toBe(2)
  })

  it('approximates clipped text and shading with only valid blocks and original surviving colors', () => {
    for (const code of [65, 176, 177, 178, 223, 221, 32]) {
      const result = rasterizePath(box(0, 0, 1, 0.5), { fg: 7, bg: 1 },
        new Map([['0,0', { code, fg: 14, bg: 4 }]])).get('0,0')!
      expect([32, 219, 220, 223, 221, 222]).toContain(result.code)
      expect([7, 14, 4]).toContain(result.fg)
      expect(result.bg).toBe(1)
    }
  })

  it('commits as one transaction and preserves undo/redo and RGB support', () => {
    const editor = new Editor(undefined, undefined, 'tundra')
    const colors = { fg: rgbColor('#123456'), bg: rgbColor('#654321') }
    const edits = rasterizePath(box(0, 0, 3, 2), colors, undefined, 'tundra')
    for (const [id, cell] of edits) editor.paint(pointFromKey(id), cell)
    editor.commit()
    expect(editor.cells).toEqual(edits)
    editor.undo()
    expect(editor.cells.size).toBe(0)
    editor.redo()
    expect(editor.cells).toEqual(edits)
  })

  it('uses even-odd filling for self intersections and rejects invalid drafts and inks', () => {
    const crossed = { origin: 0, closed: true, nodes: [node(0, 0), node(4, 4), node(0, 4), node(4, 0)] }
    expect(rasterizePath(crossed, ink).size).toBeGreaterThan(0)
    expect(() => rasterizePath({ ...crossed, closed: false }, ink)).toThrow(/closed/)
    expect(() => rasterizePath({ ...crossed, nodes: [node(0, 0)] }, ink)).toThrow(/three/)
    expect(() => rasterizePath(box(0, 0, 1, 2, MAX_ROW), ink)).toThrow(/safe/)
    expect(() => rasterizePath(box(0, 0, 1, 1), { fg: 16, bg: 0 })).toThrow(/Invalid cell/)
    expect(() => rasterizePath(box(0, 0, 1, 1), { fg: 7, bg: 8 })).toThrow(/Invalid cell/)
    expect(() => rasterizePath({ ...crossed, nodes: [node(NaN, 0), ...crossed.nodes] }, ink)).toThrow(/safe/)
    expect(() => rasterizePath({ ...crossed, nodes: [node(0, Infinity), ...crossed.nodes] }, ink)).toThrow(/safe/)
    const complex = box(0, 0, 1, 1)
    complex.nodes[0].outgoing = { x: 1_000_000_000, y: 0 }
    expect(() => rasterizePath(complex, ink)).toThrow(/complex/)
  })
})

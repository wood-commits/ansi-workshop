import draw from './assets/cursors/draw.svg?url&no-inline'
import cursor from './assets/cursors/cursor.svg?url&no-inline'
import erase from './assets/cursors/erase.svg?url&no-inline'
import recolor from './assets/cursors/recolor.svg?url&no-inline'
import select from './assets/cursors/select.svg?url&no-inline'
import move from './assets/cursors/move.svg?url&no-inline'
import primitive from './assets/cursors/primitive.svg?url&no-inline'
import path from './assets/cursors/path.svg?url&no-inline'
import gradient from './assets/cursors/gradient.svg?url&no-inline'
import fill from './assets/cursors/fill.svg?url&no-inline'
import eyedropper from './assets/cursors/eyedropper.svg?url&no-inline'

export type Tool = 'draw' | 'erase' | 'recolor' | 'select' | 'move' | 'cursor' | 'primitive' | 'path' | 'gradient' | 'fill' | 'eyedropper'

export const TOOL_CURSORS = {
  draw: `url("${draw}") 3 3, crosshair`,
  cursor: `url("${cursor}") 3 3, default`,
  erase: `url("${erase}") 3 3, crosshair`,
  recolor: `url("${recolor}") 3 3, crosshair`,
  select: `url("${select}") 3 3, crosshair`,
  move: `url("${move}") 3 3, move`,
  primitive: `url("${primitive}") 3 3, crosshair`,
  path: `url("${path}") 3 3, crosshair`,
  gradient: `url("${gradient}") 3 3, crosshair`,
  fill: `url("${fill}") 3 3, crosshair`,
  eyedropper: `url("${eyedropper}") 3 3, crosshair`,
} satisfies Record<Tool, string>

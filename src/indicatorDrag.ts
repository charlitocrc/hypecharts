import { Chart, DomPosition } from 'klinecharts'
import { INDICATOR_MENU_ITEMS } from './widget/indicator-modal/data'
import { indicatorType } from './persist'

const onChartTypes = new Set(INDICATOR_MENU_ITEMS.filter(item => item.placements.includes('main')).map(item => item.name))
// Compare has its own picker and can also be moved back from a sub-pane.
onChartTypes.add('COMPARE')
export const canDragIndicatorToMain = (name: string): boolean => onChartTypes.has(indicatorType(name))

export interface IndicatorDragOptions {
  chart: Chart
  host: HTMLElement
  sources: () => Record<string, string>
  /** A dataset switch or an open modal invalidates the pending gesture. */
  context: () => unknown
  blocked: () => boolean
  move: (name: string, paneId: string) => void
  label: string
}

const inside = (x: number, y: number, rect: { left: number, top: number, right: number, bottom: number }): boolean =>
  x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom

/** Capture only eligible titles, leaving pan/draw/axis gestures to the core. */
export function bindIndicatorDrag (options: IndicatorDragOptions): () => void {
  const { chart, host } = options
  const doc = host.ownerDocument
  const win = doc.defaultView!
  let active: { name: string, pane: string, dom: HTMLElement, id: number, x: number, y: number, context: unknown, moved: boolean } | null = null
  let hint: HTMLDivElement | null = null
  let target: HTMLDivElement | null = null
  let previousCursor = ''
  let hover: { dom: HTMLElement, cursor: string } | null = null
  const clearHover = (): void => {
    if (hover?.dom.style.cursor === 'grab') hover.dom.style.cursor = hover.cursor
    hover = null
  }
  const sourceAt = (x: number, y: number): { name: string, pane: string, dom: HTMLElement } | undefined => {
    for (const [name, pane] of Object.entries(options.sources())) {
      if (pane === 'candle_pane' || !canDragIndicatorToMain(name)) continue
      const dom = chart.getDom(pane, DomPosition.Main)
      if (!dom) continue
      const rect = dom.getBoundingClientRect()
      if (!inside(x, y, rect)) continue
      if (chart.getIndicatorTitleBounds(pane).some(bound => bound.indicatorName === name &&
        inside(x - rect.left, y - rect.top, { left: bound.x, top: bound.y, right: bound.x + bound.width, bottom: bound.y + bound.height }))) return { name, pane, dom }
    }
  }
  const over = (event: MouseEvent): void => {
    if (active) return
    clearHover()
    const source = !options.blocked() && sourceAt(event.clientX, event.clientY)
    if (source) {
      hover = { dom: source.dom, cursor: source.dom.style.cursor }
      source.dom.style.cursor = 'grab'
    }
  }
  const valid = (): boolean => active !== null && !options.blocked() && active.context === options.context() &&
    options.sources()[active.name] === active.pane && canDragIndicatorToMain(active.name)
  const targetRect = (): DOMRect | undefined => chart.getDom('candle_pane', DomPosition.Main)?.getBoundingClientRect()
  const cancel = (): void => {
    if (active) active.dom.style.cursor = previousCursor
    active = null
    hint?.remove(); hint = null
    target?.remove(); target = null
    doc.removeEventListener('pointermove', move, true)
    doc.removeEventListener('pointerup', up, true)
    doc.removeEventListener('pointercancel', cancel, true)
    doc.removeEventListener('keydown', key, true)
    win.removeEventListener('blur', cancel)
  }
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
  }
  const feedback = (x: number, y: number): void => {
    const rect = targetRect()
    if (!rect) return
    if (!hint) {
      hint = doc.createElement('div')
      hint.className = 'klinecharts-pro-indicator-drag-hint'
      hint.textContent = `${indicatorType(active!.name)} · ${options.label}`
      hint.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;padding:6px 10px;border-radius:4px;background:#1677ff;color:white;font:12px sans-serif;'
      target = doc.createElement('div')
      target.className = 'klinecharts-pro-indicator-drop-target'
      target.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;box-sizing:border-box;border:2px dashed #1677ff;background:rgba(22,119,255,.08);'
      doc.body.append(target, hint)
    }
    Object.assign(hint.style, { left: `${x + 12}px`, top: `${y + 12}px` })
    Object.assign(target!.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, opacity: inside(x, y, rect) ? '1' : '.45' })
  }
  const move = (event: PointerEvent): void => {
    if (!active || event.pointerId !== active.id) return
    if (!valid() || event.buttons === 0) { cancel(); return }
    event.preventDefault(); event.stopImmediatePropagation()
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) >= 6) active.moved = true
    if (active.moved) feedback(event.clientX, event.clientY)
  }
  const up = (event: PointerEvent): void => {
    if (!active || event.pointerId !== active.id) return
    event.preventDefault(); event.stopImmediatePropagation()
    const source = active
    const rect = targetRect()
    const commit = valid() && source.moved && rect && inside(event.clientX, event.clientY, rect)
    cancel()
    if (commit) options.move(source.name, source.pane)
  }
  const down = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || options.blocked()) return
    cancel()
    const source = sourceAt(event.clientX, event.clientY)
    if (source) {
      const { name, pane } = source
      // Cancels compatibility mouse events, so the chart never starts panning.
      event.preventDefault(); event.stopImmediatePropagation()
      chart.cancelTimeViewportAnimation()
      clearHover()
      previousCursor = source.dom.style.cursor
      source.dom.style.cursor = 'grabbing'
      active = { name, pane, dom: source.dom, id: event.pointerId, x: event.clientX, y: event.clientY, context: options.context(), moved: false }
      doc.addEventListener('pointermove', move, { capture: true, passive: false })
      doc.addEventListener('pointerup', up, true)
      doc.addEventListener('pointercancel', cancel, true)
      doc.addEventListener('keydown', key, true)
      win.addEventListener('blur', cancel)
      return
    }
  }
  host.addEventListener('pointerdown', down, { capture: true, passive: false })
  host.addEventListener('mousemove', over)
  host.addEventListener('mouseleave', clearHover)
  return () => {
    cancel(); clearHover()
    host.removeEventListener('pointerdown', down, true)
    host.removeEventListener('mousemove', over)
    host.removeEventListener('mouseleave', clearHover)
  }
}

/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ActionType, DomPosition, type KLineData } from 'klinecharts'
import type KLineChartPro from './KLineChartPro'
import type { ChartSelection, Period } from './types'
import { chartTimeAtIndex, chartIndexAtTime, containingChartIndex } from './multiChartTime'
import { constrainChartRange } from './chartViewport'
import { gridDimension, gridWeights, resizeGridPair, type ChartGridSizes } from './gridSizing'
export type { ChartGridSizes } from './gridSizing'

interface TimeScaleInternals {
  getBarSpace (): { bar: number }
  getOffsetRightBarCount (): number
  setBarSpace (barSpace: number): void
  setOffsetRightDistance (distance: number, update: boolean): void
  setViewport (barSpace: number, offsetRightBarCount: number): void
  coordinateToFloatIndex (x: number): number
  dataIndexToCoordinate (index: number): number
}
interface ChartStoreInternals {
  getTimeScaleStore (): TimeScaleInternals
  getCrosshairStore (): { set (crosshair: { x?: number, paneId?: string }): unknown }
}
const internalsOf = (chart: KLineChartPro): ChartStoreInternals | null =>
  (chart.getChart() as unknown as { getChartStore?: () => ChartStoreInternals } | null)?.getChartStore?.() ?? null

export interface ChartSyncGroupOptions {
  /** Synchronize viewport timestamp endpoints. Default true; subject to core zoom/history limits. */
  range?: boolean
  /** Map hover time to a containing target candle; gaps clear the crosshair. Default true. */
  crosshair?: boolean
  /** Link the resolved venue-qualified symbol. Default false. */
  symbol?: boolean
  /** Link the requested interval; unsupported follower intervals may snap locally. Default false. */
  period?: boolean
}
export interface ChartSyncGroup {
  add (chart: KLineChartPro): void
  remove (chart: KLineChartPro): void
  getOptions (): Required<ChartSyncGroupOptions>
  setOptions (options: ChartSyncGroupOptions): void
  destroy (): void
}
interface Geometry {
  data: KLineData[]
  period: Period
  width: number
  bar: number
  offset: number
  shape: string
  signature: string
  first: number
  last: number
  count: number
}
interface GroupMember {
  chart: KLineChartPro
  active: boolean
  applying: boolean
  pendingSelection: boolean
  rangeQueued: boolean
  viewportIntent: boolean
  selection: ChartSelection | null
  geometry?: Geometry
  release: Array<() => void>
}
interface TimeRange { from: number, to: number }
const symbolIdentity = (selection: ChartSelection): string =>
  `${selection.symbol.exchange ?? ''}:${selection.symbol.market ?? ''}:${selection.symbol.ticker}`
const periodIdentity = (selection: ChartSelection): string => `${selection.period.multiplier}:${selection.period.timespan}`

export function createChartSyncGroup (options: ChartSyncGroupOptions = {}): ChartSyncGroup {
  const settings: Required<ChartSyncGroupOptions> = { range: true, crosshair: true, symbol: false, period: false }
  const assignOptions = (next: ChartSyncGroupOptions): void => {
    for (const key of ['range', 'crosshair', 'symbol', 'period'] as const) if (typeof next[key] === 'boolean') settings[key] = next[key]!
  }
  assignOptions(options)
  const members: GroupMember[] = []
  let owner: GroupMember | null = null
  let range: TimeRange | null = null
  let destroyed = false
  const takeControl = (member: GroupMember): void => {
    if (owner !== member) {
      // A previous chart's eased gesture must not take control back after a
      // user pans/resets another chart. Price-axis state remains independent.
      members.forEach(other => { if (other !== member) other.chart.getChart()?.cancelTimeViewportAnimation?.() })
    }
    owner = member
  }

  const geometryOf = (member: GroupMember): Geometry | undefined => {
    if (!member.active || !member.selection?.dataReady || !member.selection.timeBased) return undefined
    const core = member.chart.getChart()
    const scale = internalsOf(member.chart)?.getTimeScaleStore()
    const data = core?.getDataList()
    const width = core?.getSize('candle_pane', DomPosition.Main)?.width ?? 0
    if (!scale || !data?.length || width <= 0) return undefined
    const bar = scale.getBarSpace().bar
    const offset = scale.getOffsetRightBarCount()
    const first = data[0].timestamp
    const last = data[data.length - 1].timestamp
    const shape = `${data.length}:${first}:${last}:${periodIdentity(member.selection)}`
    return { data, period: member.selection.period, width, bar, offset, shape, first, last, count: data.length,
      signature: `${shape}:${width}:${bar.toFixed(6)}:${offset.toFixed(6)}` }
  }
  const captureRange = (member: GroupMember, geometry: Geometry): TimeRange | null => {
    const scale = internalsOf(member.chart)?.getTimeScaleStore()
    if (!scale) return null
    const from = chartTimeAtIndex(geometry.data, scale.coordinateToFloatIndex(0) - 0.5, geometry.period)
    const to = chartTimeAtIndex(geometry.data, geometry.count + geometry.offset - 0.5, geometry.period)
    return from !== undefined && to !== undefined && Number.isFinite(from) && to > from ? { from, to } : null
  }
  const applyRange = (target: GroupMember, repair = 0): void => {
    if (!settings.range || !range || target.applying) return
    const geometry = geometryOf(target)
    const scale = internalsOf(target.chart)?.getTimeScaleStore()
    if (!geometry || !scale) return
    const left = chartIndexAtTime(geometry.data, range.from, geometry.period)
    const right = chartIndexAtTime(geometry.data, range.to, geometry.period)
    if (left === undefined || right === undefined || !(right > left)) return
    const bar = Math.max(1, Math.min(50, geometry.width / (right - left)))
    const offset = right + 0.5 - geometry.count
    target.applying = true
    try {
      if (Math.abs(geometry.bar - bar) > 1e-6 || Math.abs(geometry.offset - offset) > 1e-6) {
        scale.setViewport(bar, offset)
      }
      target.geometry = geometryOf(target)
      // Axis labels can change the drawable width during this very update.
      // Core range callbacks fire before the new pane bounds are committed.
      if (target.geometry && target.geometry.width !== geometry.width && repair < 3) {
        queueMicrotask(() => { if (target.active) applyRange(target, repair + 1) })
      }
    } finally { target.applying = false }
  }
  const alignMembers = (): void => {
    if (range) {
      const geometries = members.map(geometryOf).filter((value): value is Geometry => value !== undefined)
      range = constrainChartRange(range, geometries)
    }
    members.forEach(member => { applyRange(member) })
  }
  const onRange = (member: GroupMember): void => {
    if (!settings.range || member.applying || member.pendingSelection) return
    const next = geometryOf(member)
    if (!next || next.signature === member.geometry?.signature) return
    const previous = member.geometry
    const viewportIntent = member.viewportIntent
    member.viewportIntent = false
    member.geometry = next
    if (range && previous && (previous.shape !== next.shape || previous.width !== next.width)) {
      const ownerAppend = member === owner && next.first === previous.first && next.last > previous.last && next.count >= previous.count
      const userViewportChange = previous.shape === next.shape &&
        (Math.abs(previous.bar - next.bar) > 1e-6 || Math.abs(previous.offset - next.offset) > 1e-6)
      if (!viewportIntent && !ownerAppend && !userViewportChange) { alignMembers(); return }
    }
    const captured = captureRange(member, next)
    if (!captured) return
    takeControl(member)
    range = captured
    alignMembers()
  }
  const clearCrosshair = (member: GroupMember): void => {
    if (!member.active) return
    member.applying = true
    try { internalsOf(member.chart)?.getCrosshairStore().set({}) } finally { member.applying = false }
  }
  const onCrosshair = (source: GroupMember, value: { x?: number, dataIndex?: number, realDataIndex?: number }): void => {
    if (!source.active || source.applying || !settings.crosshair) return
    const geometry = geometryOf(source)
    const index = value.realDataIndex ?? value.dataIndex
    const timestamp = geometry && value.x !== undefined && index !== undefined && index >= 0 && index < geometry.data.length
      ? geometry.data[index]?.timestamp : undefined
    for (const target of members) {
      if (target === source || target.applying) continue
      const next = geometryOf(target)
      const mapped = next && timestamp !== undefined ? containingChartIndex(next.data, timestamp, next.period) : undefined
      if (mapped === undefined) { clearCrosshair(target); continue }
      const store = internalsOf(target.chart)
      const x = store?.getTimeScaleStore().dataIndexToCoordinate(mapped)
      if (x === undefined || !Number.isFinite(x)) { clearCrosshair(target); continue }
      target.applying = true
      try { store?.getCrosshairStore().set({ x, paneId: 'candle_pane' }) } finally { target.applying = false }
    }
  }
  const applyLinks = (source: GroupMember, targets = members.filter(member => member !== source)): void => {
    const selected = source.selection
    if (!selected) return
    for (const target of targets) {
      if (!target.active) continue
      const current = target.selection
      const symbolChange = settings.symbol && (!current || symbolIdentity(current) !== symbolIdentity(selected))
      const periodChange = settings.period && (!current || periodIdentity(current) !== periodIdentity(selected))
      if (!symbolChange && !periodChange) continue
      target.pendingSelection = true
      if (symbolChange) target.chart.setSymbol({ ...selected.symbol })
      if (periodChange) target.chart.setPeriod({ ...selected.period })
    }
  }
  const onSelection = (member: GroupMember, selection: ChartSelection): void => {
    if (!member.active) return
    const previous = member.selection
    member.selection = selection
    if (member.pendingSelection) {
      // Component snapshots are coalesced after local normalization. Ignore
      // just this echo; later user choices must work even during a slow load.
      member.pendingSelection = false
      if (selection.dataReady) alignMembers()
      return
    }
    const symbolChanged = !previous || symbolIdentity(previous) !== symbolIdentity(selection)
    const periodChanged = !previous || periodIdentity(previous) !== periodIdentity(selection)
    if (symbolChanged || periodChanged) {
      if (previous || member === members[0]) { takeControl(member); applyLinks(member) }
      else if (members[0]?.selection) applyLinks(members[0], [member])
    }
    if (!selection.timeBased || selection.loading) clearCrosshair(member)
    if (selection.dataReady && selection.timeBased) {
      if (range) alignMembers()
      else onRange(member)
    }
  }
  const remove = (chart: KLineChartPro): void => {
    const index = members.findIndex(member => member.chart === chart)
    if (index < 0) return
    const [member] = members.splice(index, 1)
    member.active = false
    member.release.forEach(release => release())
    member.release = []
    if (owner === member) owner = members[0] ?? null
    if (!members.length) range = null
  }
  return {
    add (chart): void {
      if (destroyed || members.some(member => member.chart === chart) || !chart.getChart()) return
      const member: GroupMember = { chart, active: true, applying: false, pendingSelection: false, rangeQueued: false, viewportIntent: false, selection: chart.getSelection(), release: [] }
      members.push(member)
      const core = chart.getChart()!
      const rangeListener = (): void => {
        if (!member.active || member.applying || member.rangeQueued) return
        member.rangeQueued = true
        queueMicrotask(() => {
          member.rangeQueued = false
          if (member.active) onRange(member)
        })
      }
      const crosshairListener = (data: any): void => { onCrosshair(member, data) }
      const viewportIntent = (): void => { if (member.active && !member.applying) member.viewportIntent = true }
      core.subscribeAction(ActionType.OnVisibleRangeChange, rangeListener)
      core.subscribeAction(ActionType.OnCrosshairChange, crosshairListener)
      core.subscribeAction(ActionType.OnZoom, viewportIntent)
      core.subscribeAction(ActionType.OnScroll, viewportIntent)
      member.release.push(() => core.unsubscribeAction(ActionType.OnVisibleRangeChange, rangeListener),
        () => core.unsubscribeAction(ActionType.OnCrosshairChange, crosshairListener),
        () => core.unsubscribeAction(ActionType.OnZoom, viewportIntent),
        () => core.unsubscribeAction(ActionType.OnScroll, viewportIntent),
        chart.subscribeSelectionChange(selection => { onSelection(member, selection) }), chart.subscribeDispose(() => remove(chart)))
      const anchor = members.find(other => other !== member && other.selection)
      if (anchor) applyLinks(anchor, [member])
      if (range) alignMembers()
      else onRange(member)
    },
    remove,
    getOptions: () => ({ ...settings }),
    setOptions (next): void {
      if (destroyed) return
      const wasRange = settings.range
      assignOptions(next)
      if (!settings.crosshair) members.forEach(clearCrosshair)
      const anchor = owner ?? members[0]
      if (anchor) applyLinks(anchor)
      if (settings.range) {
        if (!wasRange && anchor) {
          const geometry = geometryOf(anchor)
          range = geometry ? captureRange(anchor, geometry) : null
          anchor.geometry = geometry
        }
        if (!range && anchor) { anchor.geometry = undefined; onRange(anchor) }
        else alignMembers()
      }
    },
    destroy (): void { members.map(member => member.chart).forEach(remove); destroyed = true; range = null; owner = null }
  }
}

export interface ChartGridOptions {
  container: HTMLElement
  createChart: (cell: HTMLElement, index: number, cellOptions: { timeAxisVisible: boolean }) => KLineChartPro
  columns?: number
  gap?: number
  sync?: boolean | ChartSyncGroupOptions
  sharedTimeAxis?: boolean
  /** Opt-in pointer/touch/keyboard separators; no chart recreation during resizing. */
  resizable?: boolean
  /** Initial relative row/column weights. Invalid/mismatched dimensions use equal weights. */
  sizes?: Partial<ChartGridSizes>
  minCellSize?: number
  /** Called after pointer/keyboard/programmatic size commits. Storage belongs to the host. */
  onResize?: (sizes: ChartGridSizes) => void
}
export interface ChartGrid {
  charts: KLineChartPro[]
  cells: HTMLElement[]
  syncGroup: ChartSyncGroup | null
  setLayout (charts: number, columns?: number): void
  getSizes (): ChartGridSizes
  setSizes (sizes: Partial<ChartGridSizes>): void
  destroy (): void
}

export function createChartGrid (options: ChartGridOptions): ChartGrid {
  const container = options.container
  const doc = container.ownerDocument
  let charts: KLineChartPro[] = []
  let cells: HTMLElement[] = []
  let syncGroup: ChartSyncGroup | null = null
  let count = 0
  let columns = gridDimension(options.columns)
  let sizes: ChartGridSizes = { rows: [], columns: [] }
  let cancelDrag: (() => void) | undefined
  let observer: ResizeObserver | undefined
  let destroyed = false
  const separators: Array<{ element: HTMLElement, axis: 'rows' | 'columns', index: number }> = []
  const gap = typeof options.gap === 'number' && Number.isFinite(options.gap) ? Math.max(0, options.gap) : 4
  const minimum = typeof options.minCellSize === 'number' && Number.isFinite(options.minCellSize) ? Math.max(0, options.minCellSize) : 100
  const original = { display: container.style.display, columns: container.style.gridTemplateColumns,
    rows: container.style.gridTemplateRows, autoRows: container.style.gridAutoRows, gap: container.style.gap,
    height: container.style.height, position: container.style.position }
  const getSizes = (): ChartGridSizes => ({ rows: [...sizes.rows], columns: [...sizes.columns] })
  const notify = (): void => { options.onResize?.(getSizes()) }
  const available = (axis: 'rows' | 'columns'): number =>
    Math.max(0, (axis === 'rows' ? container.clientHeight : container.clientWidth) - gap * (sizes[axis].length - 1))
  const positionSeparators = (): void => {
    for (const { element, axis, index } of separators) {
      const tracks = sizes[axis]
      const fraction = tracks.slice(0, index + 1).reduce((sum, value) => sum + value, 0)
      const position = available(axis) * fraction + gap * (index + 0.5)
      element.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
      if (axis === 'rows') {
        element.style.top = `${position}px`
        element.style.left = '0'
        element.style.width = '100%'
        element.style.height = `${Math.max(6, gap)}px`
        element.style.transform = 'translateY(-50%)'
      } else {
        element.style.left = `${position}px`
        element.style.top = '0'
        element.style.height = '100%'
        element.style.width = `${Math.max(6, gap)}px`
        element.style.transform = 'translateX(-50%)'
      }
    }
  }
  const applySizes = (): void => {
    container.style.gridTemplateColumns = sizes.columns.map(weight => `minmax(0, ${weight}fr)`).join(' ')
    container.style.gridTemplateRows = sizes.rows.map(weight => `minmax(0, ${weight}fr)`).join(' ')
    positionSeparators()
  }
  const makeSeparator = (axis: 'rows' | 'columns', index: number): void => {
    const element = doc.createElement('div')
    element.className = 'klinecharts-pro-grid-separator'
    element.dataset.axis = axis
    element.dataset.boundary = String(index)
    element.tabIndex = 0
    element.setAttribute('role', 'separator')
    element.setAttribute('aria-orientation', axis === 'rows' ? 'horizontal' : 'vertical')
    element.setAttribute('aria-label', `Resize chart ${axis === 'rows' ? 'rows' : 'columns'} ${index + 1} and ${index + 2}`)
    element.setAttribute('aria-valuemin', '0')
    element.setAttribute('aria-valuemax', '100')
    Object.assign(element.style, { position: 'absolute', zIndex: '5', touchAction: 'none',
      cursor: axis === 'rows' ? 'row-resize' : 'col-resize', background: 'var(--klinecharts-grid-divider, rgba(120,123,134,0.55))', opacity: '0.65' })
    element.addEventListener('focus', () => { element.style.opacity = '1' })
    element.addEventListener('blur', () => { element.style.opacity = '0.65' })
    element.addEventListener('keydown', event => {
      const negative = axis === 'rows' ? 'ArrowUp' : 'ArrowLeft'
      const positive = axis === 'rows' ? 'ArrowDown' : 'ArrowRight'
      if (event.key !== negative && event.key !== positive) return
      event.preventDefault()
      sizes[axis] = resizeGridPair(sizes[axis], index, (event.key === negative ? -1 : 1) * (event.shiftKey ? 40 : 10), available(axis), minimum)
      applySizes(); notify()
    })
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      cancelDrag?.()
      event.preventDefault()
      element.focus()
      const pointer = event.pointerId
      const origin = axis === 'rows' ? event.clientY : event.clientX
      const before = [...sizes[axis]]
      const total = available(axis)
      try { element.setPointerCapture(pointer) } catch {}
      const move = (next: PointerEvent): void => {
        if (next.pointerId !== pointer) return
        sizes[axis] = resizeGridPair(before, index, (axis === 'rows' ? next.clientY : next.clientX) - origin, total, minimum)
        applySizes()
      }
      const finish = (commit: boolean): void => {
        doc.removeEventListener('pointermove', move)
        doc.removeEventListener('pointerup', up)
        doc.removeEventListener('pointercancel', cancel)
        element.removeEventListener('lostpointercapture', cancel)
        cancelDrag = undefined
        try { if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer) } catch {}
        if (commit) notify()
        else { sizes[axis] = before; applySizes() }
      }
      const up = (next: PointerEvent): void => { if (next.pointerId === pointer) { move(next); finish(true) } }
      const cancel = (next: PointerEvent): void => { if (next.pointerId === pointer) finish(false) }
      doc.addEventListener('pointermove', move)
      doc.addEventListener('pointerup', up)
      doc.addEventListener('pointercancel', cancel)
      element.addEventListener('lostpointercapture', cancel)
      cancelDrag = () => finish(false)
    })
    separators.push({ element, axis, index })
    container.appendChild(element)
  }
  const build = (): void => {
    cancelDrag?.()
    observer?.disconnect()
    syncGroup?.destroy()
    syncGroup = null
    charts.forEach(chart => chart.dispose())
    charts = []; cells = []; separators.length = 0
    container.innerHTML = ''
    container.classList.add('klinecharts-pro-chart-grid')
    Object.assign(container.style, { display: 'grid', gridAutoRows: '', gap: `${gap}px` })
    if (options.resizable && getComputedStyle(container).position === 'static') container.style.position = 'relative'
    const rows = Math.ceil(count / columns)
    sizes = {
      rows: gridWeights(sizes.rows.length === rows ? sizes.rows : options.sizes?.rows, rows),
      columns: gridWeights(sizes.columns.length === columns ? sizes.columns : options.sizes?.columns, columns)
    }
    applySizes()
    for (let index = 0; index < count; index++) {
      const cell = doc.createElement('div')
      Object.assign(cell.style, { minHeight: '0', minWidth: '0', height: '100%', width: '100%', boxSizing: 'border-box', gridRow: String(Math.floor(index / columns) + 1), gridColumn: String(index % columns + 1) })
      container.appendChild(cell)
      cells.push(cell)
      const lastRow = Math.floor(index / columns) === rows - 1
      charts.push(options.createChart(cell, index, { timeAxisVisible: options.sharedTimeAxis !== true || lastRow }))
    }
    if (options.sync) {
      syncGroup = createChartSyncGroup(typeof options.sync === 'object' ? options.sync : {})
      charts.forEach(chart => syncGroup!.add(chart))
    }
    if (options.resizable) {
      for (let index = 0; index < rows - 1; index++) makeSeparator('rows', index)
      for (let index = 0; index < columns - 1; index++) makeSeparator('columns', index)
      positionSeparators()
      observer = new ResizeObserver(positionSeparators)
      observer.observe(container)
    }
  }
  return {
    get charts () { return charts }, get cells () { return cells }, get syncGroup () { return syncGroup },
    getSizes,
    setSizes (next): void {
      if (destroyed || !count) return
      cancelDrag?.()
      sizes = { rows: next.rows === undefined ? sizes.rows : gridWeights(next.rows, sizes.rows.length),
        columns: next.columns === undefined ? sizes.columns : gridWeights(next.columns, columns) }
      applySizes(); notify()
    },
    setLayout (nextCount, nextColumns): void {
      if (destroyed) return
      count = gridDimension(nextCount)
      columns = Math.min(count, gridDimension(nextColumns, columns))
      build()
    },
    destroy (): void {
      if (destroyed) return
      cancelDrag?.(); observer?.disconnect(); syncGroup?.destroy()
      syncGroup = null
      charts.forEach(chart => chart.dispose())
      charts = []; cells = []; separators.length = 0
      container.innerHTML = ''
      container.classList.remove('klinecharts-pro-chart-grid')
      Object.assign(container.style, { display: original.display, gridTemplateColumns: original.columns,
        gridTemplateRows: original.rows, gridAutoRows: original.autoRows, gap: original.gap, height: original.height, position: original.position })
      destroyed = true
    }
  }
}

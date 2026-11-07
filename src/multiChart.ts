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

import { ActionType } from 'klinecharts'

import type KLineChartPro from './KLineChartPro'

/**
 * M5 increment 2: synchronize several chart instances into one group — pan/zoom
 * (same time range) and the crosshair's time position move together, TV
 * multi-chart style. Each chart keeps its own symbol, period and price scale.
 */

interface TimeScaleInternals {
  getBarSpace (): { bar: number }
  getVisibleRange (): { from: number, to: number }
  setBarSpace (barSpace: number): void
  getOffsetRightBarCount (): number
  setOffsetRightDistance (distance: number, update: boolean): void
  dataIndexToCoordinate (dataIndex: number): number
}

interface ChartStoreInternals {
  getTimeScaleStore (): TimeScaleInternals
  getCrosshairStore (): {
    set (crosshair: { x?: number, paneId?: string }): unknown
  }
}

const internalsOf = (chart: KLineChartPro): ChartStoreInternals | null => {
  const core = chart.getChart() as unknown as { getChartStore?: () => ChartStoreInternals } | null
  return core?.getChartStore?.() ?? null
}

export interface ChartSyncGroupOptions {
  /** Keep pan/zoom aligned so every chart shows the same time range. Default true. */
  range?: boolean
  /** Move the crosshair's time position together. Default true. */
  crosshair?: boolean
}

interface GroupMember {
  chart: KLineChartPro
  /** Re-entrancy guard while this member is being written to. */
  applying: boolean
  lastRangeTo: number
  lastBarSpace: number
  lastCrosshairIndex: number
}

export interface ChartSyncGroup {
  add (chart: KLineChartPro): void
  remove (chart: KLineChartPro): void
  destroy (): void
}

export function createChartSyncGroup (options: ChartSyncGroupOptions = {}): ChartSyncGroup {
  const syncRange = options.range !== false
  const syncCrosshair = options.crosshair !== false
  const members: GroupMember[] = []

  const memberOf = (chart: KLineChartPro): GroupMember | undefined =>
    members.find(member => member.chart === chart)

  const applyRange = (source: GroupMember, target: GroupMember): void => {
    if (!syncRange || target.applying) return
    const sourceInternals = internalsOf(source.chart)
    const targetInternals = internalsOf(target.chart)
    if (!sourceInternals || !targetInternals) return
    const sourceScale = sourceInternals.getTimeScaleStore()
    const targetScale = targetInternals.getTimeScaleStore()
    const sourceData = source.chart.getChart()?.getDataList()
    const targetData = target.chart.getChart()?.getDataList()
    if (sourceData === undefined || targetData === undefined || targetData.length === 0) return
    const barSpace = sourceScale.getBarSpace().bar
    const { to } = sourceScale.getVisibleRange()
    // Already aligned: same zoom and the same right edge (ranges are rounded).
    if (Math.abs(barSpace - targetScale.getBarSpace().bar) < 0.001 &&
      Math.abs(targetScale.getVisibleRange().to - to) < 0.51) {
      return
    }
    target.applying = true
    try {
      targetScale.setBarSpace(barSpace)
      // The right edge anchors the sync; charts with different history lengths
      // keep their own left edge.
      const targetOffsetRightBarCount = to - targetData.length
      if (Math.abs(targetScale.getOffsetRightBarCount() - targetOffsetRightBarCount) > 0.01) {
        targetScale.setOffsetRightDistance(targetOffsetRightBarCount * barSpace, true)
      }
      target.lastRangeTo = to
      target.lastBarSpace = barSpace
    } finally {
      target.applying = false
    }
  }

  const applyCrosshair = (source: GroupMember, target: GroupMember, dataIndex: number | undefined, paneId?: string): void => {
    if (!syncCrosshair || target.applying) return
    const targetInternals = internalsOf(target.chart)
    if (!targetInternals) return
    target.applying = true
    try {
      const crosshairStore = targetInternals.getCrosshairStore()
      if (dataIndex === undefined) {
        crosshairStore.set({})
        target.lastCrosshairIndex = -1
      } else {
        const x = targetInternals.getTimeScaleStore().dataIndexToCoordinate(dataIndex)
        if (Number.isFinite(x)) {
          crosshairStore.set({ x, paneId })
          target.lastCrosshairIndex = dataIndex
        }
      }
    } finally {
      target.applying = false
    }
  }

  return {
    add (chart: KLineChartPro): void {
      if (memberOf(chart) !== undefined || chart.getChart() === null) return
      const member: GroupMember = {
        chart,
        applying: false,
        lastRangeTo: Number.NaN,
        lastBarSpace: 0,
        lastCrosshairIndex: -1
      }
      members.push(member)
      const core = chart.getChart() as unknown as {
        subscribeAction?: (type: ActionType, callback: (data: any) => void) => void
      }
      core?.subscribeAction?.(ActionType.OnVisibleRangeChange, range => {
        if (member.applying) return
        const to = range?.to
        const barSpace = internalsOf(chart)?.getTimeScaleStore().getBarSpace().bar
        if (typeof to !== 'number' || typeof barSpace !== 'number') return
        if (Math.abs(to - member.lastRangeTo) < 0.01 && Math.abs(barSpace - member.lastBarSpace) < 0.001) return
        member.lastRangeTo = to
        member.lastBarSpace = barSpace
        members.forEach(other => { if (other !== member) applyRange(member, other) })
      })
      core?.subscribeAction?.(ActionType.OnCrosshairChange, crosshair => {
        if (member.applying) return
        const dataIndex = typeof crosshair?.dataIndex === 'number' && crosshair.x !== undefined ? crosshair.dataIndex : undefined
        if (dataIndex === member.lastCrosshairIndex) return
        member.lastCrosshairIndex = dataIndex ?? -1
        members.forEach(other => { if (other !== member) applyCrosshair(member, other, dataIndex, crosshair?.paneId) })
      })
      // Pull the newcomer into the group's current view.
      const anchor = members.find(candidate => candidate !== member)
      if (anchor !== undefined) applyRange(anchor, member)
    },

    remove (chart: KLineChartPro): void {
      const index = members.findIndex(member => member.chart === chart)
      if (index >= 0) members.splice(index, 1)
    },

    destroy (): void {
      members.length = 0
    }
  }
}

/**
 * M5 increment 2 (WORK-002): compose chart instances into a CSS grid — one
 * cell per chart — optionally wired into a sync group, so hosts don't have to
 * hand-roll the layout plumbing. The grid owns its container's content.
 */
export interface ChartGridOptions {
  /** The element the grid renders into; the grid owns its content. */
  container: HTMLElement
  /**
   * One chart per cell, created in row-major order. `cellOptions.timeAxisVisible`
   * is false for every cell that has a grid row below it when `sharedTimeAxis`
   * is on — those charts hide their own time axis so the grid reads as one
   * chart with a single shared axis on the bottom row.
   */
  createChart: (cell: HTMLElement, index: number, cellOptions: { timeAxisVisible: boolean }) => KLineChartPro
  /** Grid columns; rows follow the chart count. Defaults to 1. */
  columns?: number
  /** Cell gap in px. Default 4. */
  gap?: number
  /** Wire a sync group across the created charts. */
  sync?: boolean | ChartSyncGroupOptions
  /**
   * Show the time axis only on the last grid row (Trading Platform multi-chart
   * layout style); the range stays synchronized through the sync group.
   * Default false — every chart keeps its own time axis.
   */
  sharedTimeAxis?: boolean
}

export interface ChartGrid {
  charts: KLineChartPro[]
  cells: HTMLElement[]
  syncGroup: ChartSyncGroup | null
  /** Rebuild the grid with a new chart count (and optional columns). */
  setLayout (charts: number, columns?: number): void
  /** Dispose every chart, tear the group down and empty the container. */
  destroy (): void
}

export function createChartGrid (options: ChartGridOptions): ChartGrid {
  const container = options.container
  let charts: KLineChartPro[] = []
  let cells: HTMLElement[] = []
  let syncGroup: ChartSyncGroup | null = null
  let count = 0
  let columns = options.columns ?? 1

  const build = (): void => {
    syncGroup?.destroy()
    syncGroup = null
    charts.forEach(chart => chart.dispose())
    charts = []
    cells = []
    container.innerHTML = ''
    container.classList.add('klinecharts-pro-chart-grid')
    const gap = options.gap ?? 4
    container.style.display = 'grid'
    container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`
    container.style.gridAutoRows = '1fr'
    container.style.gap = `${gap}px`
    container.style.height = '100%'
    const sharedTimeAxis = options.sharedTimeAxis === true
    for (let index = 0; index < count; index++) {
      const cell = document.createElement('div')
      cell.style.minHeight = '0'
      cell.style.minWidth = '0'
      container.appendChild(cell)
      cells.push(cell)
      const lastRow = index >= count - columns
      const chart = options.createChart(cell, index, { timeAxisVisible: !sharedTimeAxis || lastRow })
      charts.push(chart)
    }
    if (options.sync) {
      syncGroup = createChartSyncGroup(typeof options.sync === 'object' ? options.sync : {})
      charts.forEach(chart => syncGroup!.add(chart))
    }
  }

  return {
    get charts () { return charts },
    get cells () { return cells },
    get syncGroup () { return syncGroup },
    setLayout (nextCount: number, nextColumns?: number): void {
      count = Math.max(1, nextCount)
      columns = Math.max(1, nextColumns ?? columns)
      build()
    },
    destroy (): void {
      syncGroup?.destroy()
      syncGroup = null
      charts.forEach(chart => chart.dispose())
      charts = []
      cells = []
      container.innerHTML = ''
      container.classList.remove('klinecharts-pro-chart-grid')
      container.style.display = ''
      container.style.gridTemplateColumns = ''
      container.style.gridAutoRows = ''
      container.style.gap = ''
      container.style.height = ''
    }
  }
}

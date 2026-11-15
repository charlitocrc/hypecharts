import { describe, expect, it } from 'vitest'
import type { KLineData } from 'klinecharts'
import { visibleRangeVolumeProfile, sessionVolumeProfile } from './volume-profile'

const data: KLineData[] = [
  { timestamp: 0, open: 0, high: 10, low: 0, close: 10, volume: 100 },
  { timestamp: 86400000, open: 10, high: 10, low: 0, close: 0, volume: 100 }
]
const render = (session: boolean, params: number[], range = { from: 0, to: 2 }, unsupported = false) => {
  const rects: Array<{ width: number, color: string }> = []
  const lines: number[][] = []
  const labels: string[] = []
  const ctx = {
    fillStyle: '',
    fillRect: (_x: number, _y: number, width: number) => { rects.push({ width, color: ctx.fillStyle }) },
    beginPath: () => {}, moveTo: (x: number) => { lines.push([x]) },
    lineTo: (x: number) => { lines[lines.length - 1].push(x) }, stroke: () => {},
    fillText: (text: string) => { labels.push(text) }
  }
  const template = session ? sessionVolumeProfile : visibleRangeVolumeProfile
  template.draw!({
    ctx, kLineDataList: data, indicator: { calcParams: params, extendData: { volumeProfile: { bars: data, unsupported } } },
    visibleRange: range, bounding: { width: 1000 }, barSpace: { halfBar: 5 },
    xAxis: { convertToPixel: (i: number) => i * 10 }, yAxis: { convertToPixel: (p: number) => p }
  } as any)
  return { rects, lines, labels }
}

describe('volume profile rendering', () => {
  it('stacks estimated up/down volume and independently hides level lines', () => {
    const result = render(false, [2, 100, 30, 1, 0, 0, 0])
    expect(result.lines).toEqual([])
    expect(result.rects.map(rect => rect.width)).toEqual([150, 150, 150, 150])
    expect(result.rects[0].color).toContain('8,153,129')
    expect(result.rects[1].color).toContain('242,54,69')
    expect(result.labels[0]).toContain('OHLCV estimate')
  })

  it('extends each daily POC and VA line to the right edge when enabled', () => {
    const result = render(true, [2, 100, 70, 0, 1, 1, 1])
    expect(result.lines).toEqual([[-5, 1000], [-5, 1000], [-5, 1000], [5, 1000], [5, 1000], [5, 1000]])
  })

  it('safely clamps future/negative viewport boundaries and skips unsupported sessions', () => {
    expect(render(true, [2, 70, 70], { from: -100, to: 1000 }).lines).toHaveLength(6)
    const unsupported = render(true, [2, 70, 70], { from: 0, to: 2 }, true)
    expect(unsupported.rects).toEqual([])
    expect(unsupported.labels[0]).toContain('unavailable')
  })
})

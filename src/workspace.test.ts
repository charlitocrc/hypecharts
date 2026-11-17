import { describe, expect, it } from 'vitest'
import { createWorkspaceStore, toChartWorkspace, toNamedWorkspace } from './workspace'
import type { ChartWorkspaceState } from './workspace'
const chart: ChartWorkspaceState = { version: 1, symbol: { ticker: 'BTC', exchange: 'TEST', market: 'perp' },
  period: { multiplier: 1, timespan: 'minute', text: '1m' }, indicators: { main: [], sub: [{ name: 'VOL', pane: 'shared', height: 120 }, { name: 'EMA', pane: 'shared' }] },
  drawings: [{ name: 'horizontalStraightLine', points: [{ value: 100 }], objectGroup: 'Analysis' }], settings: { timezone: 'UTC' }, theme: 'dark', locale: 'en-US', viewport: { from: 1, to: 2 } }
function store () {
  const memory = new Map<string, string>()
  return createWorkspaceStore('test', { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value) } })
}
describe('versioned named local workspaces', () => {
  it('saves complete independent chart cells and grid settings, renames and deletes', () => {
    const storage = store()
    const saved = storage.save('Analysis', [chart, { ...chart, symbol: { ticker: 'ETH' } }], { columns: 2, sizes: { columns: [2, 1], rows: [1] }, links: { symbol: false, period: true } })
    chart.symbol.ticker = 'changed'
    expect(storage.list()[0].charts[0].symbol.ticker).toBe('BTC')
    chart.symbol.ticker = 'BTC'
    expect(saved.charts[0].indicators.sub[1].pane).toBe('shared')
    expect(saved.charts[0].drawings[0].objectGroup).toBe('Analysis')
    storage.rename(saved.id, 'Research')
    expect(storage.list()[0].name).toBe('Research')
    storage.remove(saved.id);expect(storage.list()).toEqual([])
  })
  it('updates by stable ID, rejects duplicate names and invalid formats', () => {
    const storage = store(), saved = storage.save('One', [chart])
    expect(storage.save('Updated', [chart], undefined, saved.id).id).toBe(saved.id)
    expect(storage.list()).toHaveLength(1)
    expect(() => storage.save(' updated ', [chart])).toThrow('already exists')
    expect(() => storage.save('', [chart])).toThrow('Invalid')
    expect(toChartWorkspace({ ...chart, version: 999 })).toBeNull()
    expect(toNamedWorkspace({ version: 1, charts: [chart] })).toBeNull()
    expect(toChartWorkspace({ ...chart, drawings: [{ name: 'line', points: [{ value: Infinity }] }] })).toBeNull()
  })
  it('surfaces quota failures and preserves the existing workspace', () => {
    let value: string | null = null, fail = false
    const storage = createWorkspaceStore('test', { getItem: () => value, setItem: (_key, next) => { if (fail) throw new Error('Quota exceeded');value = next } })
    storage.save('One', [chart]);fail = true
    expect(() => storage.save('Two', [chart])).toThrow('Quota exceeded')
    expect(storage.list().map(item => item.name)).toEqual(['One'])
  })
})

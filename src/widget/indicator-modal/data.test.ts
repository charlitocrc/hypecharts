import { describe, expect, it } from 'vitest'

import { INDICATOR_MENU_ITEMS, POPULAR_INDICATORS, searchIndicatorItems } from './data'

const expectedMain = [
  'MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI', 'VWAP', 'SUPERTREND',
  'ICHIMOKU', 'WMA', 'HMA', 'VWMA', 'KC', 'DC', 'DEMA', 'TEMA',
  'ENV', 'PIVOT', 'ALLIGATOR', 'LRC', 'VRVP', 'SVP', 'KAMA', 'CE',
  'TYP', 'MED', 'MACROSS', 'MAEMACROSS', 'EMACROSS',
  'ALMA', 'MCGINLEY', 'LSMA', 'ZIGZAG', 'FRACTAL', 'W52',
  'VSTOP', 'CKS',
  'ABB', 'ABBR', 'DCC', 'DOJI', 'DSB', 'DSBR', 'DTSG', 'DFDJ',
  'ENGB', 'ENGBR', 'EDJS', 'EVST', 'FTM3', 'FWIN', 'GRDJ', 'HAMR',
  'HGMR', 'HRMB', 'HRMBR', 'HRXB', 'HRXBR', 'IVHM', 'KIKB', 'KIKBR',
  'LLS', 'LUS', 'MZBW', 'MZBB', 'MDJS', 'MOST', 'ONNK', 'PIER',
  'RTM3', 'RWIN', 'SHST', 'SPTW', 'SPTB', 'TBC', 'TWS', 'TJSTB',
  'TJSTBR', 'TWB', 'TWT', 'UTSG',
  'CPALL', 'CPBFLAG', 'CPBRFLAG', 'CPBPEN', 'CPBRPEN', 'CPDT', 'CPDB', 'CPTT', 'CPTB',
  'CPHS', 'CPIHS', 'CPRW', 'CPFW', 'CPTRI', 'CPRECT', 'CPCUP', 'CPICUP', 'CPEW'
]

const expectedSub = [
  'MA', 'EMA', 'VOL', 'MACD', 'BOLL', 'KDJ', 'RSI', 'BIAS', 'BRAR',
  'CCI', 'DMI', 'CR', 'PSY', 'DMA', 'TRIX', 'OBV', 'VR', 'WR', 'MTM',
  'EMV', 'SAR', 'SMA', 'ROC', 'PVT', 'BBI', 'AO', 'ATR', 'STOCHRSI',
  'MFI', 'CMF', 'STOCH', 'AROON', 'UO', 'TSI', 'CHAIKIN', 'HV', 'ADL',
  'EFI', 'VORTEX', 'CHOP', 'FISHER', 'BBW', 'BBB', 'STDDEV', 'PPO', 'VO',
  'DPO', 'COPPOCK', 'KVO', 'KST', 'LRSLOPE',
  'CHAVOL', 'RVI', 'C2C', 'C2CZT', 'VOHLC', 'UI', 'CMO', 'CRSI', 'SMI', 'MASS', 'SMIE', 'RVGI'
]

describe('indicator menu catalog', () => {
  it('contains each of the 156 selectable indicators exactly once', () => {
    const names = INDICATOR_MENU_ITEMS.map(item => item.name)
    expect(names).toHaveLength(156)
    expect(new Set(names).size).toBe(156)
  })

  it('preserves every existing main and sub placement', () => {
    const main = INDICATOR_MENU_ITEMS.filter(item => item.placements.includes('main')).map(item => item.name).sort()
    const sub = INDICATOR_MENU_ITEMS.filter(item => item.placements.includes('sub')).map(item => item.name).sort()
    expect(main).toEqual([...expectedMain].sort())
    expect(sub).toEqual([...expectedSub].sort())
  })

  it('opens with a ranked popular set', () => {
    expect(POPULAR_INDICATORS.map(item => item.popularRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('searches abbreviations, common names, and localized labels globally', () => {
    expect(searchIndicatorItems('MACD').map(item => item.name)).toContain('MACD')
    expect(searchIndicatorItems('relative strength').map(item => item.name)).toEqual(expect.arrayContaining(['RSI', 'STOCHRSI']))
    expect(searchIndicatorItems('超级趋势', item => item.name === 'SUPERTREND' ? '超级趋势' : item.name).map(item => item.name)).toEqual(['SUPERTREND'])
  })
})

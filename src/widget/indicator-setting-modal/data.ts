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

export interface IndicatorParamConfig {
  paramNameKey: string
  precision: number
  min: number
  max?: number
  default?: number
  optional?: boolean
  styleKey?: string
  options?: string[]
}

// Auto chart patterns: the reference documents these inputs but not their defaults.
const percentInput = (paramNameKey: string, value: number): IndicatorParamConfig =>
  ({ paramNameKey, precision: 2, min: 0, default: value })
const IN_PROGRESS: IndicatorParamConfig = { paramNameKey: 'pattern_in_progress', precision: 0, min: 0, max: 1, default: 0, options: ['pattern_off', 'pattern_on'] }
const PATTERN_DISPLAY: IndicatorParamConfig[] = [
  { paramNameKey: 'pattern_show', precision: 0, min: 0, max: 3, default: 0, options: ['pattern_show_all', 'pattern_show_awaiting_reached', 'pattern_show_awaiting', 'pattern_show_last_awaiting'] },
  { paramNameKey: 'pattern_targets', precision: 0, min: 0, max: 3, default: 0, options: ['pattern_show_all', 'pattern_show_awaiting', 'pattern_show_awaiting_reached', 'pattern_targets_none'] },
  IN_PROGRESS
]
// Last in every list: saved layouts store params by position.
const FAILED: IndicatorParamConfig = { paramNameKey: 'pattern_failed', precision: 0, min: 0, max: 1, default: 0, options: ['pattern_failed_show', 'pattern_failed_hide'] }
const DOUBLE_INPUTS = [
  ...PATTERN_DISPLAY,
  percentInput('pattern_trend_height', 50),
  { paramNameKey: 'pattern_second_extreme', precision: 0, min: 0, max: 2, default: 0, options: ['pattern_second_both', 'pattern_second_higher', 'pattern_second_lower'] },
  percentInput('pattern_deviation', 10),
  FAILED
]
const TRIPLE_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_trend_height', 50), percentInput('pattern_extremes', 10), percentInput('pattern_intermediate', 25), FAILED]
const HS_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_trend_height', 50), FAILED]
const FLAG_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_deviation', 25), percentInput('pattern_max_rollback', 50), FAILED]
const PENNANT_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_max_rollback', 50), FAILED]
const WEDGE_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_width_ratio', 30), FAILED]
const TRIANGLE_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_deviation', 20), FAILED]
const RECTANGLE_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_deviation', 10), FAILED]
const CUP_INPUTS = [...PATTERN_DISPLAY, percentInput('pattern_deviation', 10), percentInput('pattern_handle_rollback', 33), percentInput('pattern_cup_rollback', 0), FAILED]

const data: Record<string, IndicatorParamConfig[]> = {
  CPALL: [...PATTERN_DISPLAY, FAILED],
  CPBFLAG: FLAG_INPUTS,
  CPBRFLAG: FLAG_INPUTS,
  CPBPEN: PENNANT_INPUTS,
  CPBRPEN: PENNANT_INPUTS,
  CPDT: DOUBLE_INPUTS,
  CPDB: DOUBLE_INPUTS,
  CPTT: TRIPLE_INPUTS,
  CPTB: TRIPLE_INPUTS,
  CPHS: HS_INPUTS,
  CPIHS: HS_INPUTS,
  CPRW: WEDGE_INPUTS,
  CPFW: WEDGE_INPUTS,
  CPTRI: TRIANGLE_INPUTS,
  CPRECT: RECTANGLE_INPUTS,
  CPCUP: CUP_INPUTS,
  CPICUP: CUP_INPUTS,
  CPEW: [
    { paramNameKey: 'pattern_invert', precision: 0, min: 0, max: 1, default: 0, options: ['pattern_off', 'pattern_on'] },
    { paramNameKey: 'pattern_length_type', precision: 0, min: 0, max: 1, default: 0, options: ['pattern_length_absolute', 'pattern_length_percent'] },
    IN_PROGRESS
  ],
  ADL: [],
  ALLIGATOR: [
    { paramNameKey: 'jaw_period', precision: 0, min: 1, default: 13 },
    { paramNameKey: 'jaw_shift', precision: 0, min: 0, default: 8 },
    { paramNameKey: 'teeth_period', precision: 0, min: 1, default: 8 },
    { paramNameKey: 'teeth_shift', precision: 0, min: 0, default: 5 },
    { paramNameKey: 'lips_period', precision: 0, min: 1, default: 5 },
    { paramNameKey: 'lips_shift', precision: 0, min: 0, default: 3 }
  ],
  AROON: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 }
  ],
  CMF: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 }
  ],
  CHAIKIN: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 10 }
  ],
  DEMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 9 }
  ],
  ENV: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'deviation_percent', precision: 2, min: 0.01, default: 10 }
  ],
  EFI: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 13 }
  ],
  MFI: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 }
  ],
  LRC: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 100 },
    { paramNameKey: 'standard_deviation', precision: 2, min: 0.01, default: 2 }
  ],
  KAMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 2 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 30 }
  ],
  CE: [
    { paramNameKey: 'atr_period', precision: 0, min: 1, default: 22 },
    { paramNameKey: 'multiplier', precision: 2, min: 0.01, default: 3 }
  ],
  CHOP: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 14 }
  ],
  FISHER: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 9 }
  ],
  BBW: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'standard_deviation', precision: 2, min: 0.01, default: 2 },
    { paramNameKey: 'lookback_period', precision: 0, min: 1, default: 125 }
  ],
  BBB: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'standard_deviation', precision: 2, min: 1, default: 2 }
  ],
  STDDEV: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 }
  ],
  TYP: [],
  MED: [],
  PPO: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 26 }
  ],
  VO: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 5 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 10 }
  ],
  MACROSS: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 9, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 21, styleKey: 'lines[1].color' }
  ],
  MAEMACROSS: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 9, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 21, styleKey: 'lines[1].color' }
  ],
  EMACROSS: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 9, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 21, styleKey: 'lines[1].color' }
  ],
  DPO: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 21 }
  ],
  COPPOCK: [
    { paramNameKey: 'roc_length_1', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'roc_length_2', precision: 0, min: 1, default: 11 },
    { paramNameKey: 'wma_period', precision: 0, min: 1, default: 10 }
  ],
  KVO: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 34 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 55 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 13 }
  ],
  KST: [
    { paramNameKey: 'roc_1_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'roc_2_period', precision: 0, min: 1, default: 15 },
    { paramNameKey: 'roc_3_period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'roc_4_period', precision: 0, min: 1, default: 30 },
    { paramNameKey: 'smoothing_1_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'smoothing_2_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'smoothing_3_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'smoothing_4_period', precision: 0, min: 1, default: 15 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 9 }
  ],
  MCGINLEY: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 }
  ],
  ALMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'offset', precision: 2, min: 0, max: 1, default: 0.85 },
    { paramNameKey: 'sigma', precision: 2, min: 0.01, default: 6 }
  ],
  LSMA: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 25 }
  ],
  LRSLOPE: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 25 }
  ],
  ZIGZAG: [
    { paramNameKey: 'pivot_legs', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'deviation_percent', precision: 2, min: 0.01, default: 5 }
  ],
  FRACTAL: [
    { paramNameKey: 'bars_per_side', precision: 0, min: 1, default: 2 }
  ],
  W52: [
    { paramNameKey: 'weeks', precision: 0, min: 1, default: 52 }
  ],
  CHAVOL: [
    { paramNameKey: 'ema_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'lookback_period', precision: 0, min: 1, default: 10 }
  ],
  RVI: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 10 },
    { paramNameKey: 'smoothing_period', precision: 0, min: 1, default: 14 }
  ],
  C2C: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 10 },
    { paramNameKey: 'bars_per_year', precision: 0, min: 1, default: 252 }
  ],
  C2CZT: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 10 },
    { paramNameKey: 'bars_per_year', precision: 0, min: 1, default: 252 }
  ],
  VOHLC: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'bars_per_year', precision: 0, min: 1, default: 252 }
  ],
  UI: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 }
  ],
  VSTOP: [
    { paramNameKey: 'atr_period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'multiplier', precision: 2, min: 0.01, default: 2 }
  ],
  CKS: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'offset', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'multiplier', precision: 2, min: 0.01, default: 1 }
  ],
  CMO: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 20 }
  ],
  CRSI: [
    { paramNameKey: 'rsi_period', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'streak_period', precision: 0, min: 1, default: 2 },
    { paramNameKey: 'percentrank_period', precision: 0, min: 1, default: 100 }
  ],
  SMI: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'smoothing_period', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 5 }
  ],
  MASS: [
    { paramNameKey: 'ema_period', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'sum_period', precision: 0, min: 1, default: 25 }
  ],
  SMIE: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 13 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 25 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 5 }
  ],
  RVGI: [],
  ABB: [],
  ABBR: [],
  DCC: [],
  DOJI: [],
  DSB: [],
  DSBR: [],
  DTSG: [],
  DFDJ: [],
  ENGB: [],
  ENGBR: [],
  EDJS: [],
  EVST: [],
  FTM3: [],
  FWIN: [],
  GRDJ: [],
  HAMR: [],
  HGMR: [],
  HRMB: [],
  HRMBR: [],
  HRXB: [],
  HRXBR: [],
  IVHM: [],
  KIKB: [],
  KIKBR: [],
  LLS: [],
  LUS: [],
  MZBW: [],
  MZBB: [],
  MDJS: [],
  MOST: [],
  ONNK: [],
  PIER: [],
  RTM3: [],
  RWIN: [],
  SHST: [],
  SPTW: [],
  SPTB: [],
  TBC: [],
  TWS: [],
  TJSTB: [],
  TJSTBR: [],
  TWB: [],
  TWT: [],
  UTSG: [],
  VRVP: [
    { paramNameKey: 'row_count', precision: 0, min: 1, max: 200, default: 24 },
    { paramNameKey: 'value_area_percent', precision: 0, min: 1, max: 100, default: 70 },
    { paramNameKey: 'width_percent', precision: 0, min: 1, max: 100, default: 30 }
  ],
  SVP: [
    { paramNameKey: 'row_count', precision: 0, min: 1, max: 200, default: 24 },
    { paramNameKey: 'value_area_percent', precision: 0, min: 1, max: 100, default: 70 },
    { paramNameKey: 'width_percent', precision: 0, min: 1, max: 100, default: 70 }
  ],
  HV: [
    { paramNameKey: 'period', precision: 0, min: 2, default: 20 }
  ],
  PIVOT: [],
  STOCH: [
    { paramNameKey: 'stochastic_period', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'k_smoothing', precision: 0, min: 1, default: 1 },
    { paramNameKey: 'd_smoothing', precision: 0, min: 1, default: 3 }
  ],
  TEMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 9 }
  ],
  TSI: [
    { paramNameKey: 'long_period', precision: 0, min: 1, default: 25 },
    { paramNameKey: 'short_period', precision: 0, min: 1, default: 13 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 13 }
  ],
  UO: [
    { paramNameKey: 'short_period', precision: 0, min: 1, default: 7 },
    { paramNameKey: 'middle_period', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'long_period', precision: 0, min: 1, default: 28 }
  ],
  VORTEX: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 }
  ],
  ATR: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 }
  ],
  AO: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 5 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 34 }
  ],
  BIAS: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 6, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 12, styleKey: 'lines[1].color' },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 24, styleKey: 'lines[2].color' },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, optional: true, styleKey: 'lines[3].color' },
    { paramNameKey: 'line_5_period', precision: 0, min: 1, optional: true, styleKey: 'lines[4].color' }
  ],
  BOLL: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'standard_deviation', precision: 2, min: 1, default: 2 }
  ],
  DC: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 }
  ],
  BRAR: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 26 }
  ],
  BBI: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 6 },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, default: 24 }
  ],
  CCI: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 }
  ],
  CR: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 40 },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, default: 60 }
  ],
  DMA: [
    { paramNameKey: 'short_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'long_period', precision: 0, min: 1, default: 50 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 10 }
  ],
  DMI: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'adx_smoothing', precision: 0, min: 1, default: 6 }
  ],
  EMV: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 9 }
  ],
  EMA: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 6, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 12, styleKey: 'lines[1].color' },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 20, styleKey: 'lines[2].color' },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, optional: true, styleKey: 'lines[3].color' },
    { paramNameKey: 'line_5_period', precision: 0, min: 1, optional: true, styleKey: 'lines[4].color' }
  ],
  HMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 9 }
  ],
  ICHIMOKU: [
    { paramNameKey: 'conversion_period', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'base_period', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'span_b_period', precision: 0, min: 1, default: 52 },
    { paramNameKey: 'displacement', precision: 0, min: 1, default: 26 }
  ],
  KC: [
    { paramNameKey: 'ema_period', precision: 0, min: 1, default: 20 },
    { paramNameKey: 'atr_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'multiplier', precision: 2, min: 0.01, default: 2 }
  ],
  MTM: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 6 }
  ],
  MA: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 5, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 10, styleKey: 'lines[1].color' },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 30, styleKey: 'lines[2].color' },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, default: 60, styleKey: 'lines[3].color' },
    { paramNameKey: 'line_5_period', precision: 0, min: 1, optional: true, styleKey: 'lines[4].color' },
  ],
  MACD: [
    { paramNameKey: 'fast_period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'slow_period', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 9 }
  ],
  OBV: [
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 30 }
  ],
  PVT: [],
  PSY: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 6 }
  ],
  ROC: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 6 }
  ],
  RSI: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 6, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 12, styleKey: 'lines[1].color' },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 24, styleKey: 'lines[2].color' },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, optional: true, styleKey: 'lines[3].color' },
    { paramNameKey: 'line_5_period', precision: 0, min: 1, optional: true, styleKey: 'lines[4].color' }
  ],
  SMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'weight', precision: 0, min: 1, default: 2 }
  ],
  KDJ: [
    { paramNameKey: 'stochastic_period', precision: 0, min: 1, default: 9 },
    { paramNameKey: 'k_smoothing', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'd_smoothing', precision: 0, min: 1, default: 3 }
  ],
  SAR: [
    { paramNameKey: 'sar_start', precision: 0, min: 1, default: 2 },
    { paramNameKey: 'sar_increment', precision: 0, min: 1, default: 2 },
    { paramNameKey: 'sar_maximum', precision: 0, min: 1, default: 20 }
  ],
  STOCHRSI: [
    { paramNameKey: 'rsi_period', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'stochastic_period', precision: 0, min: 1, default: 14 },
    { paramNameKey: 'k_smoothing', precision: 0, min: 1, default: 3 },
    { paramNameKey: 'd_smoothing', precision: 0, min: 1, default: 3 }
  ],
  SUPERTREND: [
    { paramNameKey: 'atr_period', precision: 0, min: 1, default: 10 },
    { paramNameKey: 'multiplier', precision: 2, min: 0.01, default: 3 }
  ],
  TRIX: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 12 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 9 }
  ],
  // M5: COMPARE has no adjustable params; it is added via the Compare flow.
  COMPARE: [],
  VOL: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 5, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 10, styleKey: 'lines[1].color' },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 20, styleKey: 'lines[2].color' },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, optional: true, styleKey: 'lines[3].color' },
    { paramNameKey: 'line_5_period', precision: 0, min: 1, optional: true, styleKey: 'lines[4].color' },
  ],
  VWAP: [
    { paramNameKey: 'anchor_period', precision: 0, min: 0, max: 4, default: 0, options: ['session', 'week', 'month', 'quarter', 'year'] },
    { paramNameKey: 'band_1_multiplier', precision: 2, min: 0.01, default: 1, optional: true },
    { paramNameKey: 'band_2_multiplier', precision: 2, min: 0.01, optional: true },
    { paramNameKey: 'band_3_multiplier', precision: 2, min: 0.01, optional: true }
  ],
  VWMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 20 }
  ],
  VR: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 26 },
    { paramNameKey: 'signal_period', precision: 0, min: 1, default: 6 }
  ],
  WR: [
    { paramNameKey: 'line_1_period', precision: 0, min: 1, default: 6, styleKey: 'lines[0].color' },
    { paramNameKey: 'line_2_period', precision: 0, min: 1, default: 10, styleKey: 'lines[1].color' },
    { paramNameKey: 'line_3_period', precision: 0, min: 1, default: 14, styleKey: 'lines[2].color' },
    { paramNameKey: 'line_4_period', precision: 0, min: 1, optional: true, styleKey: 'lines[3].color' },
    { paramNameKey: 'line_5_period', precision: 0, min: 1, optional: true, styleKey: 'lines[4].color' },
  ],
  WMA: [
    { paramNameKey: 'period', precision: 0, min: 1, default: 9 }
  ]
}

export default data

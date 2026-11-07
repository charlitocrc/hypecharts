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

import { Component, Show, For, createSignal, onMount, onCleanup } from 'solid-js'

import { CandleType } from 'klinecharts'

import { Period } from '../../types'
import type { ChartType } from '../../chartType'

import i18n from '../../i18n'

import { toggleFullScreen, isFullScreen } from '../../shortcuts'

export interface PeriodBarProps {
  locale: string
  period: Period
  periods: Period[]
  quickPeriods: string[]
  candleType: ChartType
  /** Exchange-qualified resolved symbol; empty hides the search trigger. */
  symbolLabel: string
  onSymbolClick: () => void
  /** Shown beside the symbol button; opens the search dialog in compare mode (M5). */
  compareEnabled: boolean
  onCompareClick: () => void
  onPeriodChange: (period: Period) => void
  /** Opens the interval-builder modal (UX-002 custom intervals). */
  onIntervalBuilderClick?: () => void
  onCandleTypeChange: (type: ChartType) => void
  onIndicatorClick: () => void
  onSettingClick: () => void
  onScreenshotClick: () => void
  canUndo: boolean
  canRedo: boolean
  undoTitle: string
  redoTitle: string
  onUndo: () => void
  onRedo: () => void
  onObjects: () => void
  objectsVisible: boolean
}

interface CandleTypeIconProps {
  type: ChartType
}

const CandleTypeIcon: Component<CandleTypeIconProps> = props => (
  <svg class="candle-type-icon" viewBox="0 0 20 20" aria-hidden="true">
    <Show when={props.type === CandleType.CandleSolid}>
      <path d="M5 2v3m0 8v5m10-16v5m0 7v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M2.5 5h5v8h-5V5Zm10 2h5v7h-5V7Z" fill="currentColor" stroke="currentColor" stroke-width="1.2"/>
    </Show>
    <Show when={props.type === CandleType.CandleStroke}>
      <path d="M5 2v3m0 8v5m10-16v5m0 7v4M2.5 5h5v8h-5V5Zm10 2h5v7h-5V7Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </Show>
    <Show when={props.type === CandleType.CandleUpStroke}>
      <path d="M5 2v3m0 8v5m10-16v5m0 7v4M2.5 5h5v8h-5V5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12.5 7h5v7h-5V7Z" fill="currentColor" stroke="currentColor" stroke-width="1.2"/>
    </Show>
    <Show when={props.type === CandleType.CandleDownStroke}>
      <path d="M5 2v3m0 8v5m10-16v5m0 7v4M12.5 7h5v7h-5V7Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2.5 5h5v8h-5V5Z" fill="currentColor" stroke="currentColor" stroke-width="1.2"/>
    </Show>
    <Show when={props.type === CandleType.Ohlc}>
      <path d="M5 2v16M2 7h3m0 6h3m7-11v16m-3-5h3m0-6h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </Show>
    <Show when={props.type === CandleType.Area}>
      <path d="M2 16.5 6 12l3 2 4-7 5 4.5v5H2Z" fill="currentColor" fill-opacity=".22" stroke="none"/>
      <path d="m2 16.5 4-4.5 3 2 4-7 5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </Show>
    <Show when={props.type === CandleType.Line}>
      <path d="m2 15 4-5 3.5 2L14 6l4 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </Show>
    <Show when={props.type === CandleType.StepLine}>
      <path d="M2 15h4v-4h4V7h4V4h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </Show>
    <Show when={props.type === CandleType.Baseline}>
      <path d="M2 10.5h16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/>
      <path d="m2 8 4-3 3.5 3.5L14 4l4 2.5V10.5h-16Z" fill="currentColor" fill-opacity=".25" stroke="none"/>
      <path d="M2 13l4 3 3.5-2.5L14 16l4-2v3.5H2Z" fill="currentColor" fill-opacity=".35" stroke="none"/>
    </Show>
    <Show when={props.type === CandleType.HlcArea}>
      <path d="M2 13.5 6 8l3 2.5L14 4l4 3v9H2Z" fill="currentColor" fill-opacity=".25" stroke="none"/>
      <path d="m2 13.5 4-5.5 3 2.5L14 4l4 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m2 16.5 4-3.5 3 1.5 5-5 4 2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-dasharray="2.5 2"/>
    </Show>
    <Show when={props.type === 'heikin_ashi'}>
      <path d="M5 3v14m10-14v14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M2.5 6h5v6h-5V6Zm10 2h5v6h-5V8Z" fill="currentColor" fill-opacity=".45" stroke="currentColor" stroke-width="1.2"/>
    </Show>
    <Show when={props.type === 'renko'}>
      <path d="M2 13h4v4H2v-4Zm4-4h4v4H6V9Zm4-4h4v4h-4V5Zm4 4h4v4h-4V9Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </Show>
    <Show when={props.type === 'line_break'}>
      <path d="M2 11h4v6H2v-6Zm5-5h4v5H7V6Zm5-3h4v3h-4V3Z" fill="currentColor" fill-opacity=".3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    </Show>
  </svg>
)

const PeriodBar: Component<PeriodBarProps> = props => {
  let ref: Node

  const [fullScreen, setFullScreen] = createSignal(false)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [candleTypeMenuOpen, setCandleTypeMenuOpen] = createSignal(false)

  const candleTypes = (): Array<{ key: ChartType, text: string }> => [
    { key: CandleType.CandleSolid, text: i18n('candle_solid', props.locale) },
    { key: CandleType.CandleStroke, text: i18n('candle_stroke', props.locale) },
    { key: CandleType.CandleUpStroke, text: i18n('candle_up_stroke', props.locale) },
    { key: CandleType.CandleDownStroke, text: i18n('candle_down_stroke', props.locale) },
    { key: CandleType.Ohlc, text: i18n('ohlc', props.locale) },
    { key: CandleType.Area, text: i18n('area', props.locale) },
    { key: CandleType.Line, text: i18n('candle_line', props.locale) },
    { key: CandleType.StepLine, text: i18n('candle_step_line', props.locale) },
    { key: CandleType.Baseline, text: i18n('candle_baseline', props.locale) },
    { key: CandleType.HlcArea, text: i18n('candle_hlc_area', props.locale) },
    { key: 'heikin_ashi', text: i18n('heikin_ashi', props.locale) },
    { key: 'renko', text: i18n('renko', props.locale) },
    { key: 'line_break', text: i18n('line_break', props.locale) }
  ]

  const quickPeriods = () => {
    const pinned = props.periods.filter(p => props.quickPeriods.includes(p.text))
    const current = props.period
    if (current && !props.quickPeriods.includes(current.text)) {
      return [...pinned, current]
    }
    return pinned
  }

  // Second periods are trade-derived lines: the chart-type picker has nothing to offer.
  const chartTypeLocked = () => props.period.timespan === 'second'

  const fullScreenChange = () => {
    setFullScreen(isFullScreen())
  }

  const closeMenu = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null
    if (!target?.closest('.period-more-wrapper')) {
      setMenuOpen(false)
    }
    if (!target?.closest('.candle-type-wrapper')) {
      setCandleTypeMenuOpen(false)
    }
  }

  onMount(() => {
    document.addEventListener('fullscreenchange', fullScreenChange)
    document.addEventListener('mozfullscreenchange', fullScreenChange)
    document.addEventListener('webkitfullscreenchange', fullScreenChange)
    document.addEventListener('msfullscreenchange', fullScreenChange)
    document.addEventListener('click', closeMenu)
  })

  onCleanup(() => {
    document.removeEventListener('fullscreenchange', fullScreenChange)
    document.removeEventListener('mozfullscreenchange', fullScreenChange)
    document.removeEventListener('webkitfullscreenchange', fullScreenChange)
    document.removeEventListener('msfullscreenchange', fullScreenChange)
    document.removeEventListener('click', closeMenu)
  })

  return (
    <div
      ref={el => { ref = el }}
      class="klinecharts-pro-period-bar">
      <Show when={props.symbolLabel !== ''}>
        <div
          class="item symbol"
          role="button"
          tabIndex={0}
          aria-label={`${i18n('symbol_search_open', props.locale)}: ${props.symbolLabel}`}
          title={i18n('symbol_search_open', props.locale)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
          onClick={props.onSymbolClick}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5"/>
            <path d="M15.5 15.5L21 21"/>
          </svg>
          <span class="symbol-label">{props.symbolLabel}</span>
        </div>
      </Show>
      <Show when={props.compareEnabled}>
        <div
          class="item compare"
          role="button"
          tabIndex={0}
          aria-label={i18n('compare', props.locale)}
          title={i18n('compare', props.locale)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
          onClick={props.onCompareClick}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 3v14M3 10h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </div>
        <span class="split-line" aria-hidden="true"/>
      </Show>
      <For each={quickPeriods()}>
        {p => (
          <span
            class={`item period ${p.text === props.period.text ? 'selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={p.text === props.period.text}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
            onClick={() => { props.onPeriodChange(p) }}>
            {p.text}
          </span>
        )}
      </For>
      <div class="period-more-wrapper">
        <span
          class={`item period-more ${menuOpen() ? 'active' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={i18n('period', props.locale)}
          aria-expanded={menuOpen()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
          onClick={() => {
            setMenuOpen(open => !open)
            setCandleTypeMenuOpen(false)
          }}>
          <svg viewBox="0 0 10 6">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <Show when={menuOpen()}>
          <div class="period-menu">
            <For each={props.periods}>
              {p => (
                <span
                  class={`period-menu-item ${p.text === props.period.text ? 'selected' : ''}`}
                  onClick={() => { props.onPeriodChange(p); setMenuOpen(false) }}>
                  {p.text}
                </span>
              )}
            </For>
            <Show when={props.onIntervalBuilderClick !== undefined}>
              <span class="period-menu-item period-menu-builder" onClick={() => { setMenuOpen(false); props.onIntervalBuilderClick?.() }}>
                {i18n('interval_builder', props.locale)}
              </span>
            </Show>
          </div>
        </Show>
      </div>
      <div
        class='item tools'
        role="button"
        tabIndex={0}
        aria-label={i18n('indicator', props.locale)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
        onClick={props.onIndicatorClick}>
        <svg viewBox="0 0 20 20">
          <path d="M15.873,20L3.65079,20C1.5873,20,0,18.3871,0,16.2903L0,3.70968C-3.78442e-7,1.6129,1.5873,0,3.65079,0L15.873,0C17.9365,0,19.5238,1.6129,19.5238,3.70968C19.5238,4.35484,19.2063,4.51613,18.5714,4.51613C17.9365,4.51613,17.619,4.19355,17.619,3.70968C17.619,2.74194,16.8254,1.93548,15.873,1.93548L3.65079,1.93548C2.69841,1.93548,1.90476,2.74194,1.90476,3.70968L1.90476,16.2903C1.90476,17.2581,2.69841,18.0645,3.65079,18.0645L15.873,18.0645C16.8254,18.0645,17.619,17.2581,17.619,16.2903C17.619,15.8065,18.0952,15.3226,18.5714,15.3226C19.0476,15.3226,19.5238,15.8065,19.5238,16.2903C19.5238,18.2258,17.9365,20,15.873,20ZM14.9206,12.9032C14.7619,12.9032,14.4444,12.9032,14.2857,12.7419L11.2698,9.35484C10.9524,9.03226,10.9524,8.54839,11.2698,8.22581C11.5873,7.90323,12.0635,7.90323,12.381,8.22581L15.3968,11.6129C15.7143,11.9355,15.7143,12.4194,15.3968,12.7419C15.3968,12.9032,15.2381,12.9032,14.9206,12.9032ZM11.4286,13.2258C11.2698,13.2258,11.1111,13.2258,10.9524,13.0645C10.6349,12.7419,10.6349,12.4194,10.9524,12.0968L15.0794,7.74193C15.3968,7.41935,15.7143,7.41935,16.0317,7.74193C16.3492,8.06452,16.3492,8.3871,16.0317,8.70968L11.9048,13.0645C11.746,13.2258,11.5873,13.2258,11.4286,13.2258ZM10.3175,3.70968C10.6349,3.70968,11.4286,3.87097,11.4286,4.67742C11.4286,5.32258,10.4762,5.16129,10.1587,5.16129C8.73016,5.16129,8.25397,5.96774,8.09524,6.6129L7.77778,8.54839L9.36508,8.54839C9.68254,8.54839,10,8.87097,10,9.19355C10,9.51613,9.68254,9.83871,9.36508,9.83871L7.61905,9.83871L6.50794,14.8387Q6.34921,16.2903,5.39683,16.2903Q4.44444,16.2903,4.92064,14.8387L6.03175,10L4.60317,10C4.28571,10,3.96825,9.67742,3.96825,9.35484C3.96825,8.70968,4.28571,8.54839,4.60317,8.54839L6.34921,8.54839L6.8254,6.45161C7.14286,3.70968,9.52381,3.54839,10.3175,3.70968ZM18.4127,6.6129C18.5714,6.12903,18.8889,5.96774,19.3651,5.96774C19.8413,6.12903,20,6.45161,20,6.93548L18.4127,13.3871C18.254,13.871,17.9365,14.0323,17.4603,14.0323C16.9841,13.871,16.8254,13.5484,16.8254,13.0645L18.4127,6.6129Z"/>
        </svg>
        <span>{i18n('indicator', props.locale)}</span>
      </div>
      <Show when={!chartTypeLocked()}>
        <div class="candle-type-wrapper">
          <div
            class={`item tools candle-type ${candleTypeMenuOpen() ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={i18n('candle_type', props.locale)}
            aria-haspopup="menu"
            aria-expanded={candleTypeMenuOpen()}
            title={i18n('candle_type', props.locale)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
            onClick={() => {
              setCandleTypeMenuOpen(open => !open)
              setMenuOpen(false)
            }}>
            <CandleTypeIcon type={props.candleType}/>
          </div>
          <Show when={candleTypeMenuOpen()}>
            <div class="candle-type-menu" role="menu">
              <For each={candleTypes()}>
                {option => (
                  <span
                    class={`candle-type-menu-item ${option.key === props.candleType ? 'selected' : ''}`}
                    role="menuitemradio"
                    aria-checked={option.key === props.candleType}
                    onClick={() => {
                      props.onCandleTypeChange(option.key)
                      setCandleTypeMenuOpen(false)
                    }}>
                    <span class="selection-mark" aria-hidden="true">{option.key === props.candleType ? '✓' : ''}</span>
                    <CandleTypeIcon type={option.key}/>
                    <span>{option.text}</span>
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
      <div
        class='item tools'
        role="button"
        tabIndex={0}
        aria-label={i18n('setting', props.locale)}
        title={i18n('setting', props.locale)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
        onClick={props.onSettingClick}>
        <svg viewBox="0 0 20 20">
          <path d="M19.7361,12.542L18.1916,11.2919C18.2647,10.8678,18.3025,10.4347,18.3025,10.0017C18.3025,9.56861,18.2647,9.13555,18.1916,8.71142L19.7361,7.46135C19.9743,7.26938,20.0615,6.95686,19.9554,6.6756L19.9342,6.61756C19.5074,5.49026,18.8755,4.45449,18.0549,3.53926L18.0124,3.49238C17.8096,3.26692,17.4819,3.1821,17.1848,3.28032L15.2677,3.92544C14.5603,3.3763,13.7704,2.94324,12.9168,2.63966L12.5466,0.742229C12.49,0.449802,12.2472,0.222111,11.9383,0.168536L11.8746,0.157375C10.6461,-0.0524583,9.35391,-0.0524583,8.1254,0.157375L8.06174,0.168536C7.75284,0.222111,7.50997,0.449802,7.45338,0.742229L7.08082,2.64859C6.2343,2.95217,5.44909,3.383,4.74641,3.92991L2.81522,3.28032C2.52047,3.1821,2.19036,3.26469,1.98757,3.49238L1.94513,3.53926C1.12455,4.45672,0.492609,5.49249,0.0658141,6.61756L0.0445921,6.6756C-0.0615171,6.95463,0.0257283,7.26715,0.263885,7.46135L1.82723,8.72482C1.75413,9.14448,1.71876,9.57308,1.71876,9.99944C1.71876,10.428,1.75413,10.8566,1.82723,11.2741L0.263885,12.5375C0.025729,12.7295,-0.0615164,13.042,0.0445929,13.3233L0.0658148,13.3813C0.49261,14.5064,1.12455,15.5444,1.94513,16.4596L1.98757,16.5065C2.19036,16.732,2.51812,16.8168,2.81522,16.7186L4.74641,16.069C5.44909,16.6159,6.2343,17.0489,7.08082,17.3503L7.45338,19.2567C7.50997,19.5491,7.75284,19.7768,8.06174,19.8303L8.1254,19.8415C8.74084,19.9464,9.37042,20,10,20C10.6296,20,11.2615,19.9464,11.8746,19.8415L11.9383,19.8303C12.2472,19.7768,12.49,19.5491,12.5466,19.2567L12.9168,17.3592C13.7704,17.0556,14.5603,16.6248,15.2677,16.0734L17.1848,16.7186C17.4795,16.8168,17.8096,16.7342,18.0124,16.5065L18.0549,16.4596C18.8755,15.5422,19.5074,14.5064,19.9342,13.3813L19.9554,13.3233C20.0615,13.0487,19.9743,12.7362,19.7361,12.542ZM16.5175,8.97483C16.5764,9.3119,16.6071,9.65791,16.6071,10.0039C16.6071,10.3499,16.5764,10.6959,16.5175,11.033L16.3618,11.9281L18.1233,13.3545C17.8568,13.9372,17.5196,14.4863,17.1188,14.9975L14.9305,14.2631L14.1901,14.839C13.6266,15.2765,12.9994,15.6203,12.3203,15.8614L11.4219,16.1806L10.9998,18.3459C10.3372,18.4173,9.66045,18.4173,8.9955,18.3459L8.57342,16.1761L7.6821,15.8524C7.01008,15.6114,6.38521,15.2676,5.82637,14.8323L5.08596,14.2541L2.88361,14.9953C2.48275,14.4841,2.14791,13.9327,1.8791,13.3523L3.65938,11.9125L3.50611,11.0196C3.44952,10.687,3.41887,10.3432,3.41887,10.0039C3.41887,9.66237,3.44716,9.32083,3.50611,8.98822L3.65938,8.09531L1.8791,6.6555C2.14556,6.07288,2.48275,5.52374,2.88361,5.01255L5.08596,5.75367L5.82637,5.17551C6.38521,4.74022,7.01008,4.39645,7.6821,4.15536L8.57578,3.83615L8.99786,1.66638C9.66045,1.59495,10.3372,1.59495,11.0021,1.66638L11.4242,3.83168L12.3226,4.1509C12.9994,4.39198,13.6289,4.73575,14.1925,5.17328L14.9329,5.7492L17.1211,5.01479C17.522,5.52598,17.8568,6.07734,18.1256,6.65773L16.3642,8.08416L16.5175,8.97483ZM10.0024,5.85189C7.7104,5.85189,5.85231,7.61092,5.85231,9.78068C5.85231,11.9504,7.7104,13.7095,10.0024,13.7095C12.2943,13.7095,14.1524,11.9504,14.1524,9.78068C14.1524,7.61092,12.2943,5.85189,10.0024,5.85189ZM11.8699,11.5486C11.37,12.0196,10.7074,12.2808,10.0024,12.2808C9.29732,12.2808,8.63473,12.0196,8.13483,11.5486C7.6373,11.0754,7.36142,10.4481,7.36142,9.78068C7.36142,9.11323,7.6373,8.48596,8.13483,8.01272C8.63473,7.53948,9.29732,7.28054,10.0024,7.28054C10.7074,7.28054,11.37,7.53948,11.8699,8.01272C12.3674,8.48596,12.6433,9.11323,12.6433,9.78068C12.6433,10.4481,12.3674,11.0754,11.8699,11.5486Z" />
        </svg>
      </div>
      <div
        class='item tools'
        role="button"
        tabIndex={0}
        aria-label={i18n(fullScreen() ? 'exit_full_screen' : 'full_screen', props.locale)}
        title={i18n(fullScreen() ? 'exit_full_screen' : 'full_screen', props.locale)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
        onClick={() => { toggleFullScreen((ref as HTMLElement)?.parentElement) }}>
        {
          fullScreen() ? (
            <svg viewBox="0 0 20 20">
              <path d="M1.08108,0L0,1.079L4.18919,5.27938L2.54826,6.91715L6.9112,6.91715L6.9112,2.56262L5.28957,4.18112L1.08108,0ZM15.8108,5.27938L20,1.079L18.9189,0L14.7104,4.18112L13.0888,2.56262L13.0888,6.91715L17.4517,6.91715L15.8108,5.27938ZM4.16988,14.7014L0.07722,18.8054L1.1583,20L5.27027,15.7996L6.9112,17.4374L6.9112,13.0829L2.54826,13.0829L4.16988,14.7014ZM17.4517,13.0829L13.0888,13.0829L13.0888,17.4374L14.7297,15.7996L18.8417,20L19.9228,18.8054L15.8301,14.7013L17.4517,13.0829Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20">
              <path d="M2.93444,1.76899L7.57544,6.40999L6.38918,7.59626L1.76899,2.93444L0,4.70343L0,0L4.70343,0L2.93444,1.76899ZM6.40999,12.4037L1.76899,17.0447L0,15.2758L0,19.9792L4.70343,19.9792L2.93444,18.2102L7.57544,13.5692L6.40999,12.4037ZM15.2758,0L17.0447,1.76899L12.4037,6.40999L13.59,7.59626L18.231,2.95526L20,4.72425L20,0L15.2758,0ZM13.5692,12.4037L12.3829,13.59L17.0239,18.231L15.2549,20L19.9792,20L19.9792,15.2758L18.2102,17.0447L13.5692,12.4037Z"/>
            </svg>
          )
        }
      </div>
      <div
        class='item tools'
        role="button"
        tabIndex={0}
        aria-label={i18n('screenshot', props.locale)}
        title={i18n('screenshot', props.locale)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click() } }}
        onClick={props.onScreenshotClick}>
        <svg viewBox="0 0 20 20">
          <path d="M6.50977,1L13.4902,1C13.6406,1,13.7695,1.1104910000000001,13.7969,1.2631700000000001L14.0273,2.52277C14.1387,3.13147,14.6543,3.57143,15.2559,3.57143L17.5,3.57143C18.8809,3.57143,20,4.72254,20,6.14286L20,16.4286C20,17.8489,18.8809,19,17.5,19L2.5,19C1.11914,19,0,17.8489,0,16.4286L0,6.14286C0,4.72254,1.11914,3.57143,2.5,3.57143L4.74414,3.57143C5.3457,3.57143,5.86133,3.13147,5.97266,2.52277L6.20312,1.2631700000000001C6.23047,1.1104910000000001,6.35937,1,6.50977,1ZM15.2559,4.857139999999999C14.0547,4.857139999999999,13.0215,3.97522,12.7988,2.75982L12.7129,2.28571L7.28711,2.28571L7.20117,2.75982C6.98047,3.97522,5.94727,4.857139999999999,4.74414,4.857139999999999L2.5,4.857139999999999C1.81055,4.857139999999999,1.25,5.43371,1.25,6.14286L1.25,16.4286C1.25,17.1377,1.81055,17.7143,2.5,17.7143L17.5,17.7143C18.1895,17.7143,18.75,17.1377,18.75,16.4286L18.75,6.14286C18.75,5.43371,18.1895,4.857139999999999,17.5,4.857139999999999L15.2559,4.857139999999999ZM4.375,6.78571L3.125,6.78571C2.7793,6.78571,2.5,6.49844,2.5,6.14286C2.5,5.78728,2.7793,5.5,3.125,5.5L4.375,5.5C4.7207,5.5,5,5.78728,5,6.14286C5,6.49844,4.7207,6.78571,4.375,6.78571ZM10,6.14286C7.06641,6.14286,4.6875,8.58973,4.6875,11.6071C4.6875,14.6246,7.06641,17.0714,10,17.0714C12.9336,17.0714,15.3125,14.6246,15.3125,11.6071C15.3125,8.58973,12.9336,6.14286,10,6.14286ZM10,7.42857C11.0859,7.42857,12.1055,7.8625,12.873,8.65201C13.6406,9.44152,14.0625,10.49018,14.0625,11.6071C14.0625,12.7241,13.6406,13.7728,12.873,14.5623C12.1055,15.3518,11.0859,15.7857,10,15.7857C8.91406,15.7857,7.89453,15.3518,7.12695,14.5623C6.35937,13.7728,5.9375,12.7241,5.9375,11.6071C5.9375,10.49018,6.35938,9.44152,7.12695,8.65201C7.89453,7.8625,8.91406,7.42857,10,7.42857ZM10,9.67857C8.96484,9.67857,8.125,10.54241,8.125,11.6071C8.125,12.6719,8.96484,13.5357,10,13.5357C11.0352,13.5357,11.875,12.6719,11.875,11.6071C11.875,10.54241,11.0352,9.67857,10,9.67857ZM10,10.96429C10.3438,10.96429,10.625,11.2536,10.625,11.6071C10.625,11.9607,10.3438,12.25,10,12.25C9.65625,12.25,9.375,11.9607,9.375,11.6071C9.375,11.2536,9.65625,10.96429,10,10.96429Z"/>
        </svg>
      </div>
      <div class="klinecharts-pro-drawing-actions">
        <button type="button" aria-label={props.undoTitle} title={props.undoTitle} disabled={!props.canUndo} onClick={props.onUndo}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M7.5 3.5 3.5 7.5l4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3.5 7.5h8.5a4.5 4.5 0 0 1 0 9H8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" aria-label={props.redoTitle} title={props.redoTitle} disabled={!props.canRedo} onClick={props.onRedo}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m12.5 3.5 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16.5 7.5H8a4.5 4.5 0 0 0 0 9h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="layers-button" aria-label={i18n('layers', props.locale)} title={i18n('layers', props.locale)} aria-expanded={props.objectsVisible} onClick={props.onObjects}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2.5 2 6.5l8 4 8-4-8-4Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="m2 10.5 8 4 8-4M2 14.5l8 4 8-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default PeriodBar

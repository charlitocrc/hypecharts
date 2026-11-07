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

import { Component, For, Index, Show, createMemo, createSignal } from 'solid-js'

import type { Period } from '../../types'

import { Modal } from '../../component'

import i18n from '../../i18n'
import { indicatorType, PlotStyle } from '../../persist'

import { PRICE_SOURCES, type PriceSourceOption } from '../../indicator/timeframe'
import data, { IndicatorParamConfig } from './data'
import {
  IndicatorParamError,
  PlotDraft,
  applyPlotStyles,
  createDefaultParamDrafts,
  createParamDrafts,
  diffPlotStyles,
  stepParamDraft,
  validateParamDrafts
} from './model'

export interface IndicatorCalcInputs {
  source: PriceSourceOption
  offset: number
  /** '' = follow the chart period. */
  timeframe: string
}

export interface IndicatorSettingParams {
  indicatorName: string
  paneId: string
  calcParams: number[]
  plots: PlotDraft[]
  plotStyles?: Record<string, PlotStyle>
  source?: string
  offset?: number
  timeframe?: string
}

export interface IndicatorSettingModalProps {
  locale: string
  /** Host period list for the per-study timeframe select (IND-002). */
  periods?: Period[]
  params: IndicatorSettingParams
  onClose: () => void
  onConfirm: (calcParams: number[] | null, plots: Record<string, PlotStyle> | undefined, inputs: IndicatorCalcInputs) => void
  onSaveTemplate?: (name: string, template: { typeId: string, calcParams?: number[], plots?: Record<string, PlotStyle>, source?: string, offset?: number, timeframe?: string }) => void
  /** IND-004: panes the study can move to (excluding its current one). */
  moveTargets?: Array<{ id: string, label: string }>
  onMovePane?: (targetPaneId: string) => void
}

const SIZES = [1, 2, 3, 4]

const SOURCE_LABEL_KEYS: Record<PriceSourceOption, string> = {
  close: 'indicator_source_close',
  open: 'indicator_source_open',
  high: 'indicator_source_high',
  low: 'indicator_source_low',
  hl2: 'indicator_source_hl2',
  hlc3: 'indicator_source_hlc3',
  ohlc4: 'indicator_source_ohlc4'
}

const IndicatorSettingModal: Component<IndicatorSettingModalProps> = props => {
  const type = (): string => indicatorType(props.params.indicatorName)
  const config = (): IndicatorParamConfig[] => data[type()] ?? []
  const [drafts, setDrafts] = createSignal(createParamDrafts(config(), props.params.calcParams))
  const validation = createMemo(() => validateParamDrafts(config(), drafts()))
  const [plots, setPlots] = createSignal(applyPlotStyles(props.params.plots, props.params.plotStyles))
  const [source, setSource] = createSignal<PriceSourceOption>(
    (PRICE_SOURCES as readonly string[]).includes(props.params.source ?? '') ? props.params.source as PriceSourceOption : 'close'
  )
  const [offset, setOffset] = createSignal(
    typeof props.params.offset === 'number' && props.params.offset !== 0 ? String(Math.round(props.params.offset)) : ''
  )
  const [timeframe, setTimeframe] = createSignal(props.params.timeframe ?? '')
  const inputs = (): IndicatorCalcInputs => ({
    source: source(),
    offset: offset().trim() === '' ? 0 : (Number(offset()) || 0),
    timeframe: timeframe()
  })
  const updatePlot = (index: number, patch: Partial<PlotDraft>): void => {
    setPlots(current => current.map((plot, plotIndex) => plotIndex === index ? { ...plot, ...patch } : plot))
  }

  const updateDraft = (index: number, value: string): void => {
    setDrafts(current => current.map((item, itemIndex) => itemIndex === index ? value : item))
  }

  const errorMessage = (error: IndicatorParamError | undefined, item: IndicatorParamConfig): string => {
    switch (error) {
      case 'required': return i18n('indicator_param_required', props.locale)
      case 'number': return i18n('indicator_param_number', props.locale)
      case 'precision': return item.precision === 0
        ? i18n('indicator_param_whole_number', props.locale)
        : `${i18n('indicator_param_decimal_places', props.locale)} ${item.precision}`
      case 'min': return `${i18n('indicator_param_minimum', props.locale)} ${item.min}`
      case 'max': return `${i18n('indicator_param_maximum', props.locale)} ${item.max}`
      case 'sequence': return i18n('indicator_param_sequence', props.locale)
      default: return ''
    }
  }

  const apply = (): void => {
    const result = validation()
    if (!result.isValid) return
    props.onConfirm(config().length > 0 ? result.values : null, diffPlotStyles(props.params.plots, plots()), inputs())
    props.onClose()
  }

  const [templateName, setTemplateName] = createSignal('')
  const saveTemplate = (): void => {
    const name = templateName().trim()
    if (name === '' || props.onSaveTemplate === undefined) return
    const result = validation()
    const plotsOverride = diffPlotStyles(props.params.plots, plots())
    const calc = inputs()
    props.onSaveTemplate(name, {
      typeId: type(),
      ...(config().length > 0 && result.isValid ? { calcParams: result.values } : {}),
      ...(plotsOverride !== undefined ? { plots: plotsOverride } : {}),
      ...(calc.source !== 'close' ? { source: calc.source } : {}),
      ...(calc.offset !== 0 ? { offset: calc.offset } : {}),
      ...(calc.timeframe !== '' ? { timeframe: calc.timeframe } : {})
    })
    setTemplateName('')
  }

  return (
    <Modal
      class="klinecharts-pro-indicator-setting-modal"
      title={i18n('indicator_settings', props.locale)}
      width={500}
      closeOnBackdrop
      onClose={props.onClose}>
      <form
        class="klinecharts-pro-indicator-setting-modal-form"
        onSubmit={event => {
          event.preventDefault()
          apply()
        }}>
        <div class="klinecharts-pro-indicator-setting-summary">
          <span class="indicator-code">{type()}</span>
          <span class="indicator-name">{i18n(type().toLowerCase(), props.locale)}</span>
          <span class="indicator-placement">
            {i18n(props.params.paneId === 'candle_pane' ? 'indicator_on_chart' : 'indicator_new_pane', props.locale)}
          </span>
          <Show when={(props.moveTargets?.length ?? 0) > 0 && props.onMovePane !== undefined}>
            <select
              class="move-pane-select"
              aria-label={i18n('indicator_move_to', props.locale)}
              value=""
              onChange={event => {
                if (event.currentTarget.value === '') return
                props.onMovePane!(event.currentTarget.value)
                props.onClose()
              }}>
              <option value="" disabled>{i18n('indicator_move_to', props.locale)}</option>
              <For each={props.moveTargets}>{target => <option value={target.id}>{target.label}</option>}</For>
            </select>
          </Show>
        </div>

        <div class="klinecharts-pro-indicator-setting-body">
        <Show when={config().length === 0 && plots().length === 0}>
          <div class="klinecharts-pro-indicator-setting-empty">
            <span class="empty-icon">✓</span>
            <span>{i18n('indicator_no_adjustable_params', props.locale)}</span>
          </div>
        </Show>
        <Show when={config().length > 0}>
          <div class="klinecharts-pro-indicator-setting-intro">
            <strong>{i18n('indicator_parameters', props.locale)}</strong>
            <span>{i18n('indicator_parameters_help', props.locale)}</span>
          </div>
          <div class="klinecharts-pro-indicator-setting-fields">
            <For each={config()}>{(item, index) => {
              const error = () => validation().errors[index()]
              const errorId = `indicator-param-${index()}-error`
              return (
                <div class="parameter-row" classList={{ invalid: error() !== undefined }}>
                  <div class="parameter-copy">
                    <label for={`indicator-param-${index()}`}>{i18n(item.paramNameKey, props.locale)}</label>
                    <div class="parameter-meta">
                      <Show when={item.default !== undefined}>
                        <span>{i18n('indicator_param_default', props.locale)}: {item.default}</span>
                      </Show>
                      <Show when={!item.options}>
                        <span>{i18n('indicator_param_min', props.locale)}: {item.min}</span>
                      </Show>
                      <Show when={item.optional}>
                        <span class="optional">{i18n('indicator_param_optional', props.locale)}</span>
                      </Show>
                    </div>
                  </div>
                  <Show when={item.options}>
                    <div class="parameter-control select">
                      <select
                        id={`indicator-param-${index()}`}
                        value={drafts()[index()] ?? ''}
                        onChange={event => updateDraft(index(), event.currentTarget.value)}>
                        <For each={item.options}>{(key, optionIndex) => (
                          <option value={String(optionIndex())}>{i18n(key, props.locale)}</option>
                        )}</For>
                      </select>
                    </div>
                  </Show>
                  <Show when={!item.options}>
                    <div class="parameter-control">
                      <button
                        type="button"
                        class="step-button"
                        aria-label={`${i18n('indicator_param_decrease', props.locale)} ${i18n(item.paramNameKey, props.locale)}`}
                        onClick={() => updateDraft(index(), stepParamDraft(drafts()[index()] ?? '', item, -1))}>
                        −
                      </button>
                      <input
                        id={`indicator-param-${index()}`}
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        value={drafts()[index()] ?? ''}
                        aria-invalid={error() !== undefined}
                        aria-describedby={error() !== undefined ? errorId : undefined}
                        onInput={event => updateDraft(index(), event.currentTarget.value)}
                        onKeyDown={event => {
                          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                            event.preventDefault()
                            updateDraft(index(), stepParamDraft(
                              drafts()[index()] ?? '',
                              item,
                              event.key === 'ArrowUp' ? 1 : -1
                            ))
                          }
                        }}/>
                      <button
                        type="button"
                        class="step-button"
                        aria-label={`${i18n('indicator_param_increase', props.locale)} ${i18n(item.paramNameKey, props.locale)}`}
                        onClick={() => updateDraft(index(), stepParamDraft(drafts()[index()] ?? '', item, 1))}>
                        +
                      </button>
                      <Show when={error() !== undefined}>
                        <span id={errorId} class="parameter-error">{errorMessage(error(), item)}</span>
                      </Show>
                    </div>
                  </Show>
                </div>
              )
            }}</For>
          </div>
        </Show>
        <div class="klinecharts-pro-indicator-setting-intro">
          <strong>{i18n('indicator_calculation', props.locale)}</strong>
          <span>{i18n('indicator_calculation_help', props.locale)}</span>
        </div>
        <div class="klinecharts-pro-indicator-setting-fields">
          <div class="parameter-row">
            <div class="parameter-copy">
              <label for="indicator-input-source">{i18n('indicator_source', props.locale)}</label>
              <div class="parameter-meta">
                <span>{i18n('indicator_param_default', props.locale)}: {i18n('indicator_source_close', props.locale)}</span>
              </div>
            </div>
            <div class="parameter-control select">
              <select
                id="indicator-input-source"
                value={source()}
                onChange={event => setSource(event.currentTarget.value as PriceSourceOption)}>
                <For each={[...PRICE_SOURCES]}>{(option) => (
                  <option value={option}>{i18n(SOURCE_LABEL_KEYS[option], props.locale)}</option>
                )}</For>
              </select>
            </div>
          </div>
          <Show when={(props.periods?.length ?? 0) > 0}>
            <div class="parameter-row">
              <div class="parameter-copy">
                <label for="indicator-input-timeframe">{i18n('indicator_timeframe', props.locale)}</label>
                <div class="parameter-meta">
                  <span>{i18n('indicator_param_default', props.locale)}: {i18n('indicator_timeframe_chart', props.locale)}</span>
                </div>
              </div>
              <div class="parameter-control select">
                <select
                  id="indicator-input-timeframe"
                  value={timeframe()}
                  onChange={event => setTimeframe(event.currentTarget.value)}>
                  <option value="">{i18n('indicator_timeframe_chart', props.locale)}</option>
                  <For each={props.periods ?? []}>{(period) => (
                    <option value={period.text}>{period.text}</option>
                  )}</For>
                </select>
              </div>
            </div>
          </Show>
          <div class="parameter-row">
            <div class="parameter-copy">
              <label for="indicator-input-offset">{i18n('indicator_offset', props.locale)}</label>
              <div class="parameter-meta">
                <span>{i18n('indicator_param_default', props.locale)}: 0</span>
              </div>
            </div>
            <div class="parameter-control">
              <input
                id="indicator-input-offset"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                value={offset()}
                onInput={event => setOffset(event.currentTarget.value)}/>
            </div>
          </div>
        </div>

        <Show when={plots().length > 0}>
          <div class="klinecharts-pro-indicator-setting-intro">
            <strong>{i18n('indicator_style', props.locale)}</strong>
            <span>{i18n('indicator_style_help', props.locale)}</span>
          </div>
          <div class="klinecharts-pro-indicator-setting-plots">
            <Index each={plots()}>{(plot, index) => (
              <div class="plot-row" classList={{ muted: !plot().visible }}>
                <label class="plot-visible">
                  <input
                    type="checkbox"
                    checked={plot().visible}
                    onChange={event => updatePlot(index, { visible: event.currentTarget.checked })}/>
                  <span>{plot().title}</span>
                </label>
                <Show when={plot().bar} fallback={(
                  <input
                    type="color"
                    aria-label={`${i18n('indicator_plot_color', props.locale)} ${plot().title}`}
                    value={plot().color}
                    onInput={event => updatePlot(index, { color: event.currentTarget.value })}/>
                )}>
                  <input
                    type="color"
                    aria-label={`${i18n('indicator_plot_color', props.locale)} ${plot().title}`}
                    title={i18n('indicator_plot_single_color', props.locale)}
                    value={plot().color === '' ? plot().upColor : plot().color}
                    onInput={event => updatePlot(index, { color: event.currentTarget.value, upColor: '', downColor: '' })}/>
                  <input
                    type="color"
                    aria-label={`${i18n('indicator_plot_up_color', props.locale)} ${plot().title}`}
                    title={i18n('indicator_plot_up_color', props.locale)}
                    value={plot().upColor}
                    onInput={event => updatePlot(index, { upColor: event.currentTarget.value, color: '' })}/>
                  <input
                    type="color"
                    aria-label={`${i18n('indicator_plot_down_color', props.locale)} ${plot().title}`}
                    title={i18n('indicator_plot_down_color', props.locale)}
                    value={plot().downColor}
                    onInput={event => updatePlot(index, { downColor: event.currentTarget.value, color: '' })}/>
                </Show>
                <Show when={plot().line}>
                  <select
                    aria-label={`${i18n('indicator_plot_width', props.locale)} ${plot().title}`}
                    value={String(plot().size)}
                    onChange={event => updatePlot(index, { size: Number(event.currentTarget.value) })}>
                    <For each={[...new Set([...SIZES, plot().size])].sort((a, b) => a - b)}>{size => (
                      <option value={String(size)}>{size}px</option>
                    )}</For>
                  </select>
                  <select
                    aria-label={`${i18n('indicator_plot_line_style', props.locale)} ${plot().title}`}
                    value={plot().style}
                    onChange={event => updatePlot(index, { style: event.currentTarget.value === 'dashed' ? 'dashed' : 'solid' })}>
                    <option value="solid">{i18n('line_solid', props.locale)}</option>
                    <option value="dashed">{i18n('line_dashed', props.locale)}</option>
                  </select>
                </Show>
                <span class="plot-opacity">
                  <input
                    type="range"
                    aria-label={`${i18n('indicator_plot_opacity', props.locale)} ${plot().title}`}
                    min="10" max="100" step="10"
                    value={plot().opacity}
                    onInput={event => updatePlot(index, { opacity: Number(event.currentTarget.value) })}/>
                  {plot().opacity}%
                </span>
              </div>
            )}</Index>
          </div>
        </Show>
        </div>

        <div class="klinecharts-pro-indicator-setting-actions">
          <button
            type="button"
            class="reset-button"
            onClick={() => {
              setDrafts(createDefaultParamDrafts(config()))
              setPlots(props.params.plots)
              setSource('close')
              setOffset('')
              setTimeframe('')
            }}>
            {i18n('restore_default', props.locale)}
          </button>
          <div class="primary-actions">
            <button type="button" class="cancel-button" onClick={props.onClose}>
              {i18n('cancel', props.locale)}
            </button>
            <button type="submit" class="apply-button" disabled={!validation().isValid}>
              {i18n('apply', props.locale)}
            </button>
          </div>
        </div>
        <Show when={props.onSaveTemplate !== undefined}>
          <div class="klinecharts-pro-indicator-setting-template">
            <input
              type="text"
              value={templateName()}
              placeholder={i18n('indicator_template_name', props.locale)}
              aria-label={i18n('indicator_template_name', props.locale)}
              onInput={event => setTemplateName(event.currentTarget.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveTemplate() } }}/>
            <button
              type="button"
              class="template-save-button"
              disabled={templateName().trim() === ''}
              onClick={saveTemplate}>
              {i18n('indicator_template_save', props.locale)}
            </button>
          </div>
        </Show>
      </form>
    </Modal>
  )
}

export default IndicatorSettingModal

import { Component, For, Index, Show, createSignal, onMount, onCleanup } from 'solid-js'
import { Modal } from '../../component'
import { TEXT_TOOLS, labelAlignOf, labelBaselineOf } from '../../extension/annotation'
import type { LabelAlign, LabelBaseline } from '../../extension/annotation'
import i18n from '../../i18n'
import type { Period } from '../../types'
import {
  FIB_LEVEL_DEFAULTS, defaultLevelColor, fibLevels, formatFibLevels, levelStylesOf, parseFibLevels, sanitizeLevelStyles, showBandsOf
} from '../../extension/fibLevels'
import type { LevelStyle } from '../../extension/fibLevels'
import { POSITION_TOOLS, riskOf } from '../../extension/position'
import { readDrawingPresets, writeDrawingPresets } from '../../persist'
import type { StoredDrawingPreset } from '../../persist'
import {
  DrawingItem, DrawingStyleDraft, LineStyle, drawingLabel, drawingStyleSections, fromUserStyles, parsePoints, pointDrafts, withLevelAwareStyles
} from './model'

interface ManagerProps {
  locale: string
  drawings: DrawingItem[]
  onEdit: (drawing: DrawingItem) => void
  onToggle: (id: string, field: 'visible' | 'lock') => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  onClose: () => void
}

export const DrawingManager: Component<ManagerProps> = props => {
  const t = (key: string) => i18n(key, props.locale)
  return <aside class="klinecharts-pro-drawing-manager" aria-label={t('drawing_objects')}>
    <div class="manager-heading"><strong>{t('drawing_objects')} ({props.drawings.length})</strong>
      <button type="button" aria-label={t('close')} onClick={props.onClose}>×</button>
    </div>
    <Show when={props.drawings.length > 0} fallback={<p>{t('drawing_objects_empty')}</p>}>
      <ul><For each={props.drawings}>{drawing => <li>
        <button type="button" class="drawing-name" onClick={() => props.onEdit(drawing)}>
          {drawingLabel(drawing.name, props.locale)}
          <Show when={typeof drawing.extendData?.text === 'string'}><small>{drawing.extendData.text}</small></Show>
          <Show when={drawing.timeframes?.length}><small>{drawing.timeframes!.join(' ')}</small></Show>
        </button>
        <div class="object-actions">
          <button type="button" aria-pressed={drawing.visible !== false} onClick={() => props.onToggle(drawing.id, 'visible')}>{t(drawing.visible === false ? 'show_drawing' : 'hide_drawing')}</button>
          <button type="button" aria-pressed={!!drawing.lock} onClick={() => props.onToggle(drawing.id, 'lock')}>{t(drawing.lock ? 'unlock_drawing' : 'lock_drawing')}</button>
          <button type="button" onClick={() => props.onDuplicate(drawing.id)}>{t('duplicate_drawing')}</button>
          <button type="button" onClick={() => props.onRemove(drawing.id)}>{t('delete_drawing')}</button>
        </div>
      </li>}</For></ul>
    </Show>
  </aside>
}

export const DrawingEditor: Component<{
  locale: string
  drawing: DrawingItem
  periods: Period[]
  defaultPreset?: string
  onSetDefaultPreset?: (name: string | null) => void
  onSave: (drawing: DrawingItem) => void
  onClose: () => void
}> = props => {
  const t = (key: string) => i18n(key, props.locale)
  let form: HTMLFormElement | undefined
  const opener = document.activeElement as HTMLElement | null
  onMount(() => form?.querySelector<HTMLElement>('input, textarea, button')?.focus())
  onCleanup(() => { if (opener?.isConnected) opener.focus() })
  const original = props.drawing
  const sections = drawingStyleSections(original.name)
  const [style, setStyle] = createSignal<DrawingStyleDraft>(fromUserStyles(original.styles?.user))
  const patchStyle = (patch: Partial<DrawingStyleDraft>) => setStyle(current => ({ ...current, ...patch }))
  const hex = (color: unknown): string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#2962ff'
  const lineColor = () => hex(style().lineColor ?? original.styles?.line?.color ?? original.styles?.polygon?.borderColor)
  const defaultLevels = () => formatFibLevels(FIB_LEVEL_DEFAULTS[original.name] ?? [])
  const [levels, setLevels] = createSignal(sections.levels ? formatFibLevels(fibLevels(original as any, original.name)) : '')
  const parsedLevels = () => parseFibLevels(levels())
  const [levelStyles, setLevelStyles] = createSignal<Record<string, LevelStyle>>(levelStylesOf(original as any))
  const [showLabels, setShowLabels] = createSignal(original.extendData?.showLabels !== false)
  const [showBands, setShowBands] = createSignal(showBandsOf(original as any))
  const patchLevel = (level: number, patch: Partial<LevelStyle>) => setLevelStyles(current => {
    const key = String(level)
    return { ...current, [key]: { ...current[key], ...patch } }
  })
  const [accountSize, setAccountSize] = createSignal(String(riskOf(original as any).accountSize ?? ''))
  const [riskPercent, setRiskPercent] = createSignal(String(riskOf(original as any).riskPercent ?? ''))
  // DRAW-003: trend-line ray projection and text-label anchoring.
  const [extendLeft, setExtendLeft] = createSignal(original.extendData?.extendLeft === true)
  const [extendRight, setExtendRight] = createSignal(original.extendData?.extendRight === true)
  const [labelAlign, setLabelAlign] = createSignal<LabelAlign>(labelAlignOf(original as any))
  const [labelBaseline, setLabelBaseline] = createSignal<LabelBaseline>(labelBaselineOf(original as any))
  const [presets, setPresets] = createSignal<StoredDrawingPreset[]>(readDrawingPresets())
  const [presetName, setPresetName] = createSignal('')
  const [selectedPreset, setSelectedPreset] = createSignal('')
  const applyPreset = (name: string): void => {
    const preset = presets().find(item => item.name === name)
    if (!preset) return
    setStyle(current => ({ ...current, ...preset.draft }))
    const presetLevels = sanitizeLevelStyles((preset.draft as any).levelStyles)
    if (sections.levels && presetLevels) {
      setLevelStyles(presetLevels)
      if (typeof preset.draft.showLabels === 'boolean') setShowLabels(preset.draft.showLabels)
      if (sections.bands && typeof preset.draft.showBands === 'boolean') setShowBands(preset.draft.showBands)
    }
  }
  const savePreset = (): void => {
    const name = presetName().trim()
    if (!name) return
    const draft: Record<string, unknown> = { ...style() }
    if (sections.levels) {
      draft.levelStyles = sanitizeLevelStyles(levelStyles()) ?? {}
      draft.showLabels = showLabels()
      if (sections.bands) draft.showBands = showBands()
    }
    const next = [...presets().filter(item => item.name !== name), { name, tool: original.name, draft }]
    setPresets(next)
    writeDrawingPresets(next)
    setPresetName('')
  }
  const deletePreset = (name: string): void => {
    const next = presets().filter(item => item.name !== name)
    setPresets(next)
    writeDrawingPresets(next)
  }
  const [points, setPoints] = createSignal(pointDrafts(original.points))
  const [text, setText] = createSignal(original.extendData?.text ?? '')
  const [locked, setLocked] = createSignal(!!original.lock)
  const [visible, setVisible] = createSignal(original.visible !== false)
  // DRAW-007: empty selection = every timeframe; a subset restricts the drawing.
  const [timeframes, setTimeframes] = createSignal<string[]>(original.timeframes ?? [])
  const toggleTimeframe = (text: string, checked: boolean) => setTimeframes(current => {
    const base = current.length === 0 ? props.periods.map(period => period.text) : current
    return checked ? [...new Set([...base, text])] : base.filter(item => item !== text)
  })
  const timeframesField = (): string[] | undefined => {
    const selected = timeframes()
    if (selected.length === 0 || selected.length === props.periods.length) return undefined
    return props.periods.filter(period => selected.includes(period.text)).map(period => period.text)
  }
  const valid = () => parsePoints(points()) !== null && (!sections.levels || parsedLevels() !== null)
  const extendData = () => {
    if (!TEXT_TOOLS.has(original.name) && !sections.levels && !POSITION_TOOLS.has(original.name) && original.name !== 'segment') {
      return original.extendData
    }
    const next = { ...(original.extendData ?? {}) }
    if (TEXT_TOOLS.has(original.name)) next.text = text()
    if (original.name === 'text') {
      // Defaults stay unset so extendData only carries real choices.
      if (labelAlign() === 'left') delete next.align
      else next.align = labelAlign()
      if (labelBaseline() === 'top') delete next.baseline
      else next.baseline = labelBaseline()
    }
    if (original.name === 'segment') {
      if (extendLeft()) next.extendLeft = true
      else delete next.extendLeft
      if (extendRight()) next.extendRight = true
      else delete next.extendRight
    }
    if (sections.levels) {
      if (levels() === defaultLevels()) delete next.levels
      else next.levels = parsedLevels()
      const clean = sanitizeLevelStyles(levelStyles())
      if (clean) next.levelStyles = clean
      else delete next.levelStyles
      if (showLabels()) delete next.showLabels
      else next.showLabels = false
      if (sections.bands) {
        if (showBands()) delete next.showBands
        else next.showBands = false
      }
    }
    if (POSITION_TOOLS.has(original.name)) {
      const account = Number(accountSize())
      const percent = Number(riskPercent())
      const risk: Record<string, number> = {}
      if (Number.isFinite(account) && account > 0) risk.accountSize = account
      if (Number.isFinite(percent) && percent > 0) risk.riskPercent = percent
      if (Object.keys(risk).length > 0) next.risk = risk
      else delete next.risk
    }
    return Object.keys(next).length > 0 ? next : null
  }
  return <Modal class="klinecharts-pro-drawing-editor" title={drawingLabel(original.name, props.locale)} width={480} closeOnBackdrop onClose={props.onClose}>
    <form ref={form} onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(form?.querySelectorAll<HTMLElement>('input, textarea, select, button:not(:disabled)') ?? [])
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }} onSubmit={event => {
      event.preventDefault()
      const nextPoints = parsePoints(points())
      if (!valid() || !nextPoints) return
      props.onSave({ ...original, points: nextPoints, lock: locked(), visible: visible(),
        styles: withLevelAwareStyles(original.styles, style(), sections.levels), extendData: extendData(),
        timeframes: timeframesField() ?? [] })
    }}>
      <Show when={presets().length > 0 || sections.line || sections.fill || sections.text || sections.levels}>
        <fieldset class="style-fields"><legend>{t('drawing_presets')}</legend>
          <Show when={presets().length > 0}>
            <label>{t('preset_apply')}
              <select value={selectedPreset()} onChange={event => {
                const name = event.currentTarget.value
                setSelectedPreset(name)
                if (name) applyPreset(name)
              }}>
                <option value="" disabled>—</option>
                <For each={presets()}>{preset => <option value={preset.name}>{preset.name}</option>}</For>
              </select>
            </label>
            <button type="button" disabled={!selectedPreset()} onClick={() => { deletePreset(selectedPreset()); setSelectedPreset('') }}>{t('preset_delete')}</button>
          </Show>
          <label>{t('preset_name')}<input type="text" value={presetName()} onInput={event => setPresetName(event.currentTarget.value)}/></label>
          <button type="button" disabled={!presetName().trim()} onClick={savePreset}>{t('preset_save')}</button>
          <Show when={props.onSetDefaultPreset !== undefined}>
            <label class="check preset-default">
              <input
                type="checkbox"
                disabled={selectedPreset() === ''}
                checked={selectedPreset() !== '' && props.defaultPreset === selectedPreset()}
                onChange={event => props.onSetDefaultPreset!(event.currentTarget.checked ? selectedPreset() : null)}/>
              {t('preset_use_for_new')}
            </label>
          </Show>
        </fieldset>
      </Show>
      <Show when={sections.line}>
        <fieldset class="style-fields"><legend>{t('drawing_line')}</legend>
          <label>{t('drawing_color')}<input type="color" value={lineColor()} onInput={event => patchStyle({ lineColor: event.currentTarget.value })}/></label>
          <label>{t('drawing_width')}<select aria-label={t('drawing_width')} value={String(style().lineWidth ?? original.styles?.line?.size ?? 1)} onChange={event => patchStyle({ lineWidth: Number(event.currentTarget.value) })}>
            <For each={[1, 2, 3, 4, 5, 6, 8, 10]}>{size => <option value={String(size)}>{size}px</option>}</For>
          </select></label>
          <label>{t('drawing_line_style')}<select aria-label={t('drawing_line_style')} value={style().lineStyle ?? 'solid'} onChange={event => patchStyle({ lineStyle: event.currentTarget.value as LineStyle })}>
            <option value="solid">{t('line_solid')}</option>
            <option value="dashed">{t('line_dashed')}</option>
            <option value="dotted">{t('line_dotted')}</option>
          </select></label>
          <label>{t('drawing_line_opacity')} {style().lineOpacity ?? 100}%<input type="range" aria-label={t('drawing_line_opacity')} min="10" max="100" step="10" value={style().lineOpacity ?? 100} onInput={event => patchStyle({ lineOpacity: Number(event.currentTarget.value) })}/></label>
        </fieldset>
      </Show>
      <Show when={sections.fill}>
        <fieldset class="style-fields"><legend>{t('drawing_fill')}</legend>
          <label>{t('drawing_fill_color')}<input type="color" value={hex(style().fillColor)} onInput={event => patchStyle({ fillColor: event.currentTarget.value })}/></label>
          <label>{t('drawing_opacity')} {style().fillOpacity ?? 20}%<input type="range" aria-label={t('drawing_opacity')} min="0" max="100" step="5" value={style().fillOpacity ?? 20} onInput={event => patchStyle({ fillColor: hex(style().fillColor), fillOpacity: Number(event.currentTarget.value) })}/></label>
        </fieldset>
      </Show>
      <Show when={sections.text}>
        <fieldset class="style-fields"><legend>{t('drawing_text_style')}</legend>
          <label>{t('drawing_text_color')}<input type="color" value={hex(style().textColor ?? original.styles?.text?.color)} onInput={event => patchStyle({ textColor: event.currentTarget.value })}/></label>
          <label>{t('drawing_text_size')}<select aria-label={t('drawing_text_size')} value={String(style().textSize ?? original.styles?.text?.size ?? 12)} onChange={event => patchStyle({ textSize: Number(event.currentTarget.value) })}>
            <For each={[10, 11, 12, 14, 16, 18, 20, 24, 28]}>{size => <option value={String(size)}>{size}px</option>}</For>
          </select></label>
          <label class="check"><input type="checkbox" checked={!!style().textBold} onChange={event => patchStyle({ textBold: event.currentTarget.checked })}/>{t('drawing_text_bold')}</label>
          <Show when={original.name === 'text'}>
            <label>{t('drawing_label_align')}
              <select aria-label={t('drawing_label_align')} value={labelAlign()} onChange={event => setLabelAlign(event.currentTarget.value as LabelAlign)}>
                <option value="left">{t('align_left')}</option>
                <option value="center">{t('align_center')}</option>
                <option value="right">{t('align_right')}</option>
              </select>
            </label>
            <label>{t('drawing_label_valign')}
              <select aria-label={t('drawing_label_valign')} value={labelBaseline()} onChange={event => setLabelBaseline(event.currentTarget.value as LabelBaseline)}>
                <option value="top">{t('valign_top')}</option>
                <option value="middle">{t('valign_middle')}</option>
                <option value="bottom">{t('valign_bottom')}</option>
              </select>
            </label>
          </Show>
          <label class="check"><input type="checkbox" checked={style().textBackground !== undefined} onChange={event => patchStyle({ textBackground: event.currentTarget.checked ? '#2962ff' : undefined })}/>{t('drawing_text_background')}</label>
          <Show when={style().textBackground !== undefined}>
            <label>{t('drawing_text_background')}<input type="color" value={hex(style().textBackground)} onInput={event => patchStyle({ textBackground: event.currentTarget.value })}/></label>
          </Show>
        </fieldset>
      </Show>
      <Show when={sections.levels}>
        <fieldset><legend>{t('fib_levels')}</legend>
          <label>{t('fib_levels_help')}<input type="text" inputmode="decimal" value={levels()} aria-invalid={parsedLevels() === null} onInput={event => setLevels(event.currentTarget.value)}/></label>
          <Index each={parsedLevels() ?? []}>{(level, index) => <div class="level-fields">
            <span>{level().toFixed(3).replace(/\.?0+$/, '') || '0'}</span>
            <input type="color" aria-label={`${t('drawing_color')} ${index + 1}`} value={hex(levelStyles()[String(level())]?.color ?? defaultLevelColor(level()))} onInput={event => patchLevel(level(), { color: event.currentTarget.value })}/>
            <label class="check"><input type="checkbox" checked={levelStyles()[String(level())]?.visible !== false} onChange={event => patchLevel(level(), { visible: event.currentTarget.checked })}/>{t('fib_level_visible')}</label>
          </div>}</Index>
          <label class="check"><input type="checkbox" checked={showLabels()} onChange={event => setShowLabels(event.currentTarget.checked)}/>{t('fib_show_labels')}</label>
          <Show when={sections.bands}>
            <label class="check"><input type="checkbox" checked={showBands()} onChange={event => setShowBands(event.currentTarget.checked)}/>{t('fib_show_bands')}</label>
          </Show>
        </fieldset>
      </Show>
      <Show when={POSITION_TOOLS.has(original.name)}>
        <fieldset class="style-fields"><legend>{t('position_risk')}</legend>
          <label>{t('position_account_size')}<input type="number" min="0" step="any" value={accountSize()} onInput={event => setAccountSize(event.currentTarget.value)}/></label>
          <label>{t('position_risk_percent')}<input type="number" min="0" max="100" step="any" value={riskPercent()} onInput={event => setRiskPercent(event.currentTarget.value)}/></label>
        </fieldset>
      </Show>
      <Show when={sections.line || sections.fill || sections.text || sections.levels}>
        <button type="button" class="reset-style" onClick={() => { setStyle({}); setLevels(defaultLevels()); setLevelStyles({}); setShowLabels(true); setShowBands(true) }}>{t('drawing_reset_style')}</button>
      </Show>
      <Show when={TEXT_TOOLS.has(original.name)}>
        <label>{t('text')}<textarea rows={3} value={text()} onInput={event => setText(event.currentTarget.value)}/></label>
      </Show>
      <Show when={original.points.length <= 8} fallback={<p>{t('drawing_edit_on_chart')}</p>}>
        <fieldset><legend>{t('drawing_coordinates')}</legend>
          <Index each={points()}>{(point, index) => <div class="point-fields">
            <span>{index + 1}</span>
            <Show when={point().value !== undefined}><label>{t('drawing_price')}
              <input type="number" step="any" required value={point().value} onInput={event => {
                const value = event.currentTarget.value
                setPoints(current => current.map((p, i) => i === index ? { ...p, value } : p))
              }}/></label></Show>
            <Show when={point().time !== undefined}><label>{t('drawing_time_utc')}
              <input type="datetime-local" step="1" required value={point().time} onInput={event => {
                const time = event.currentTarget.value
                setPoints(current => current.map((p, i) => i === index ? { ...p, time } : p))
              }}/></label></Show>
          </div>}</Index>
        </fieldset>
      </Show>
      <Show when={props.periods.length > 1}>
        <fieldset class="style-fields"><legend>{t('drawing_timeframes')}</legend>
          <label class="check"><input type="checkbox" checked={timeframes().length === 0} onChange={event => setTimeframes(event.currentTarget.checked ? [] : props.periods.map(period => period.text))}/>{t('drawing_timeframes_all')}</label>
          <div class="timeframe-choices">
            <For each={props.periods}>{period => <label class="check">
              <input type="checkbox" checked={timeframes().length === 0 || timeframes().includes(period.text)} onChange={event => toggleTimeframe(period.text, event.currentTarget.checked)}/>
              {period.text}
            </label>}</For>
          </div>
        </fieldset>
      </Show>
      <Show when={original.name === 'segment'}>
        <div class="timeframe-choices">
          <label class="check"><input type="checkbox" checked={extendLeft()} onChange={event => setExtendLeft(event.currentTarget.checked)}/>{t('drawing_extend_left')}</label>
          <label class="check"><input type="checkbox" checked={extendRight()} onChange={event => setExtendRight(event.currentTarget.checked)}/>{t('drawing_extend_right')}</label>
        </div>
      </Show>
      <label class="check"><input type="checkbox" checked={locked()} onChange={event => setLocked(event.currentTarget.checked)}/>{t('lock_drawing')}</label>
      <label class="check"><input type="checkbox" checked={visible()} onChange={event => setVisible(event.currentTarget.checked)}/>{t('show_drawing')}</label>
      <div class="editor-actions"><button type="button" onClick={props.onClose}>{t('cancel')}</button><button type="submit" disabled={!valid()}>{t('apply')}</button></div>
    </form>
  </Modal>
}

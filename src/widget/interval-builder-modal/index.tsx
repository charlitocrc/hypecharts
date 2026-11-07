/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Component, createSignal, Show } from 'solid-js'

import { Modal } from '../../component'

import i18n from '../../i18n'

import { periodText } from '../../aggregate'
import type { Period } from '../../types'

export interface IntervalBuilderModalProps {
  locale: string
  onClose: () => void
  /** Receives the built period; the caller wires feed declaration + persistence. */
  onConfirm: (period: Period) => void
}

const UNITS: Array<{ key: Period['timespan'], labelKey: string }> = [
  { key: 'second', labelKey: 'unit_second' },
  { key: 'minute', labelKey: 'unit_minute' },
  { key: 'hour', labelKey: 'unit_hour' },
  { key: 'day', labelKey: 'unit_day' },
  { key: 'week', labelKey: 'unit_week' },
  { key: 'month', labelKey: 'unit_month' }
]

const IntervalBuilderModal: Component<IntervalBuilderModalProps> = props => {
  const t = (key: string) => i18n(key, props.locale)
  const [value, setValue] = createSignal('15')
  const [unit, setUnit] = createSignal<Period['timespan']>('minute')

  const multiplier = (): number => Number(value())
  const valid = (): boolean => Number.isInteger(multiplier()) && multiplier() >= 1 && multiplier() <= 999
  const preview = (): string => (valid() ? periodText(multiplier(), unit()) : '—')

  const confirm = (): void => {
    if (!valid()) return
    props.onConfirm({ multiplier: multiplier(), timespan: unit(), text: periodText(multiplier(), unit()) })
    props.onClose()
  }

  return (
    <Modal
      class="klinecharts-pro-interval-builder-modal"
      title={t('interval_builder_title')}
      width={380}
      closeOnBackdrop
      buttons={[
        { type: 'cancel', children: i18n('cancel', props.locale), onClick: props.onClose },
        { type: 'confirm', children: i18n('interval_builder_apply', props.locale), onClick: confirm }
      ]}
      onClose={props.onClose}>
      <div class="interval-builder-fields">
        <label class="interval-builder-field">
          <span>{t('interval_builder_value')}</span>
          <input
            type="number"
            min="1"
            max="999"
            step="1"
            aria-invalid={!valid()}
            value={value()}
            onKeyDown={event => { if (event.key === 'Enter') confirm() }}
            onInput={event => setValue(event.currentTarget.value)}/>
        </label>
        <label class="interval-builder-field">
          <span>{t('interval_builder_unit')}</span>
          <select
            value={unit()}
            onChange={event => setUnit(event.currentTarget.value as Period['timespan'])}>
            {UNITS.map(option => <option value={option.key}>{t(option.labelKey)}</option>)}
          </select>
        </label>
      </div>
      <p class="interval-builder-preview">
        {t('interval_builder_preview')}: <strong>{preview()}</strong>
      </p>
      <Show when={!valid()}>
        <p class="interval-builder-help">{t('interval_builder_invalid')}</p>
      </Show>
    </Modal>
  )
}

export default IntervalBuilderModal

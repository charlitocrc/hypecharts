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

import { Component, createSignal } from 'solid-js'

import { Modal } from '../../component'

import i18n from '../../i18n'

export interface GoToDateModalProps {
  locale: string
  onClose: () => void
  /** Receives the parsed UTC timestamp of the picked date. */
  onConfirm: (timestamp: number) => void
}

const GoToDateModal: Component<GoToDateModalProps> = props => {
  const t = (key: string) => i18n(key, props.locale)
  const [value, setValue] = createSignal('')
  // The drawing editor treats coordinate inputs as UTC; mirror that here so a
  // pasted ISO-style date lands on the same bar everywhere.
  const parsed = (): number => Date.parse(`${value()}Z`)
  const valid = () => value() !== '' && Number.isFinite(parsed())

  const confirm = (): void => {
    if (!valid()) return
    props.onConfirm(parsed())
    props.onClose()
  }

  return (
    <Modal
      class="klinecharts-pro-go-to-date-modal"
      title={t('go_to_date')}
      width={380}
      closeOnBackdrop
      buttons={[
        { type: 'cancel', children: i18n('cancel', props.locale), onClick: props.onClose },
        { type: 'confirm', children: i18n('confirm', props.locale), onClick: confirm }
      ]}
      onClose={props.onClose}>
      <label class="go-to-date-field">
        <span>{t('go_to_date_field')}</span>
        <input
          type="datetime-local"
          step="1"
          value={value()}
          onKeyDown={event => { if (event.key === 'Enter') confirm() }}
          onInput={event => setValue(event.currentTarget.value)}/>
      </label>
      <p class="go-to-date-help">{t('go_to_date_help')}</p>
    </Modal>
  )
}

export default GoToDateModal

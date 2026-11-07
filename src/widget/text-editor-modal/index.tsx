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

import { Component, onMount } from 'solid-js'

import { Modal } from '../../component'

import i18n from '../../i18n'

export interface TextEditorModalProps {
  locale: string
  text: string
  onConfirm: (text: string) => void
  onClose: () => void
}

const TextEditorModal: Component<TextEditorModalProps> = props => {
  let ref: HTMLTextAreaElement | undefined
  const confirm = () => { props.onConfirm(ref?.value ?? '') }

  onMount(() => {
    ref?.focus()
    ref?.select()
  })

  return (
    <Modal
      title={i18n('edit_text', props.locale)}
      width={380}
      buttons={[
        { type: 'cancel', children: i18n('cancel', props.locale), onClick: props.onClose },
        { type: 'confirm', children: i18n('confirm', props.locale), onClick: confirm }
      ]}
      onClose={props.onClose}>
      <textarea
        ref={ref}
        class="klinecharts-pro-text-editor"
        rows={4}
        maxLength={500}
        value={props.text}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            props.onClose()
          }
        }}/>
      <p class="klinecharts-pro-text-editor-hint">{i18n('text_editor_hint', props.locale)}</p>
    </Modal>
  )
}

export default TextEditorModal

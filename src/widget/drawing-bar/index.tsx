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

import { Component, For, Show, createMemo, createSignal } from 'solid-js'

import { OverlayCreate, OverlayMode } from 'klinecharts'

import { List } from '../../component'

import i18n from '../../i18n'
import {
  createSingleLineOptions, createMoreLineOptions,
  createPolygonOptions, createFibonacciOptions, createWaveOptions,
  createForecastOptions, createAnnotationOptions, createBrushOptions,
  createMagnetOptions,
  Icon
} from './icons'

export interface DrawingBarProps {
  locale: string
  activeName: string
  cursorMode: CursorMode
  continuous: boolean
  favorites: string[]
  onToggleFavorite: (name: string) => void
  onDrawingItemClick: (overlay: OverlayCreate) => void
  onCursorModeChange: (mode: CursorMode) => void
  onModeChange: (mode: string) => void,
  onLockChange: (lock: boolean) => void
  onVisibleChange: (visible: boolean) => void
  onContinuousChange: (continuous: boolean) => void
  onRemoveClick: (groupId: string) => void
}

export const DRAWING_GROUP_ID = 'drawing_tools'
export type CursorMode = 'arrow' | 'crosshair'

const optionLabel = (text: unknown, fallback: string): string => typeof text === 'string' ? text : fallback

const pressOnKey = (e: KeyboardEvent & { currentTarget: HTMLElement }) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    e.currentTarget.click()
  }
}

const PopoverArrow: Component<{ open: boolean }> = props => (
  <svg
    class={props.open ? 'rotate' : ''}
    viewBox="0 0 4 6">
    <path d="M1.07298,0.159458C0.827521,-0.0531526,0.429553,-0.0531526,0.184094,0.159458C-0.0613648,0.372068,-0.0613648,0.716778,0.184094,0.929388L2.61275,3.03303L0.260362,5.07061C0.0149035,5.28322,0.0149035,5.62793,0.260362,5.84054C0.505822,6.05315,0.903789,6.05315,1.14925,5.84054L3.81591,3.53075C4.01812,3.3556,4.05374,3.0908,3.92279,2.88406C3.93219,2.73496,3.87113,2.58315,3.73964,2.46925L1.07298,0.159458Z" stroke="none" stroke-opacity="0"/>
  </svg>
)

const DrawingBar: Component<DrawingBarProps> = props => {
  const [singleLineIcon, setSingleLineIcon] = createSignal('horizontalStraightLine')
  const [moreLineIcon, setMoreLineIcon] = createSignal('priceChannelLine')
  const [polygonIcon, setPolygonIcon] = createSignal('circle')
  const [fibonacciIcon, setFibonacciIcon] = createSignal('fibonacciLine')
  const [waveIcon, setWaveIcon] = createSignal('xabcd')
  const [forecastIcon, setForecastIcon] = createSignal('longPosition')
  const [annotationIcon, setAnnotationIcon] = createSignal('text')
  const [brushIcon, setBrushIcon] = createSignal('brush')

  const [modeIcon, setModeIcon] = createSignal('weak_magnet')
  const [mode, setMode] = createSignal('normal')

  const [lock, setLock] = createSignal(false)

  const [visible, setVisible] = createSignal(true)

  const [popoverKey, setPopoverKey] = createSignal('')

  const cursorOptions = createMemo(() => [
    { key: 'arrow' as CursorMode, icon: 'cursorArrow', text: i18n('cursor_arrow', props.locale) },
    { key: 'crosshair' as CursorMode, icon: 'crosshair', text: i18n('cursor_crosshair', props.locale) }
  ])

  const currentCursor = createMemo(() => cursorOptions().find(option => option.key === props.cursorMode) ?? cursorOptions()[1])

  const overlays = createMemo(() => [
    { key: 'singleLine', icon: singleLineIcon(), list: createSingleLineOptions(props.locale), setter: setSingleLineIcon },
    { key: 'moreLine', icon: moreLineIcon(), list: createMoreLineOptions(props.locale), setter: setMoreLineIcon },
    { key: 'polygon', icon: polygonIcon(), list: createPolygonOptions(props.locale), setter: setPolygonIcon },
    { key: 'fibonacci', icon: fibonacciIcon(), list: createFibonacciOptions(props.locale), setter: setFibonacciIcon },
    { key: 'wave', icon: waveIcon(), list: createWaveOptions(props.locale), setter: setWaveIcon },
    { key: 'forecast', icon: forecastIcon(), list: createForecastOptions(props.locale), setter: setForecastIcon },
    { key: 'annotation', icon: annotationIcon(), list: createAnnotationOptions(props.locale), setter: setAnnotationIcon },
    { key: 'brush', icon: brushIcon(), list: createBrushOptions(props.locale), setter: setBrushIcon }
  ].map(item => ({ ...item, label: optionLabel(item.list.find(data => data.key === item.icon)?.text, item.icon) })))

  const toolLookup = createMemo(() => {
    const map = new Map<string, { text: string, activate: () => void }>()
    overlays().forEach(item => {
      item.list.forEach(data => {
        map.set(data.key, {
          text: optionLabel(data.text, data.key),
          activate: () => { item.setter(data.key); props.onDrawingItemClick({ groupId: DRAWING_GROUP_ID, name: data.key, visible: visible(), lock: lock(), mode: mode() as OverlayMode }) }
        })
      })
    })
    return map
  })

  const favoriteTools = createMemo(() => props.favorites
    .map(key => ({ key, text: toolLookup().get(key)?.text ?? key, activate: toolLookup().get(key)!.activate }))
    .filter(tool => toolLookup().has(tool.key)))

  const modes = createMemo(() => createMagnetOptions(props.locale))

  const modeLabel = createMemo(() => optionLabel(modes().find(data => data.key === modeIcon())?.text, modeIcon()))

  return (
    <div
      class="klinecharts-pro-drawing-bar">
      <div
        class="item"
        classList={{ 'popover-open': popoverKey() === 'cursor' }}
        tabIndex={0}
        onBlur={() => { setPopoverKey('') }}>
        <span
          role="button"
          tabIndex={0}
          aria-label={currentCursor().text}
          aria-haspopup="menu"
          aria-expanded={popoverKey() === 'cursor'}
          data-tooltip={currentCursor().text}
          class="tool-button is-active"
          onKeyDown={pressOnKey}
          onClick={() => { setPopoverKey(popoverKey() === 'cursor' ? '' : 'cursor') }}>
          <Icon name={currentCursor().icon}/>
        </span>
        <div
          class="icon-arrow"
          aria-hidden="true"
          onClick={() => { setPopoverKey(popoverKey() === 'cursor' ? '' : 'cursor') }}>
          <PopoverArrow open={popoverKey() === 'cursor'}/>
        </div>
        {
          popoverKey() === 'cursor' && (
            <List class="list cursor-list">
              {
                cursorOptions().map(option => (
                  <li
                    classList={{ 'is-selected': props.cursorMode === option.key }}
                    role="menuitemradio"
                    aria-checked={props.cursorMode === option.key}
                    onClick={() => {
                      props.onCursorModeChange(option.key)
                      setPopoverKey('')
                    }}>
                    <Icon name={option.icon}/>
                    <span style="padding-left:8px">{option.text}</span>
                  </li>
                ))
              }
            </List>
          )
        }
      </div>
      <span class="split-line"/>
      <Show when={favoriteTools().length > 0}>
        <div class="item favorites-group">
          <For each={favoriteTools()}>
            {tool => (
              <span
                role="button"
                tabIndex={0}
                aria-label={tool.text}
                aria-pressed={props.activeName === tool.key}
                data-tooltip={tool.text}
                class="tool-button"
                classList={{ 'is-active': props.activeName === tool.key }}
                onKeyDown={pressOnKey}
                onClick={() => tool.activate()}>
                <Icon name={tool.key}/>
              </span>
            )}
          </For>
        </div>
        <span class="split-line"/>
      </Show>
      {
        overlays().map(item => (
          <div
            class="item"
            classList={{ 'popover-open': item.key === popoverKey() }}
            tabIndex={0}
            onBlur={() => { setPopoverKey('') }}>
            <span
              role="button"
              tabIndex={0}
              aria-label={item.label}
              aria-pressed={props.activeName === item.icon}
              data-tooltip={item.label}
              class="tool-button"
              classList={{ 'is-active': props.activeName === item.icon }}
              onKeyDown={pressOnKey}
              onClick={() => { props.onDrawingItemClick({ groupId: DRAWING_GROUP_ID, name: item.icon, visible: visible(), lock: lock(), mode: mode() as OverlayMode }) }}>
              <Icon name={item.icon} />
            </span>
            <div
              class="icon-arrow"
              onClick={() => { setPopoverKey(item.key === popoverKey() ? '' : item.key) }}>
              <PopoverArrow open={item.key === popoverKey()}/>
            </div>
            {
              item.key === popoverKey() && (
                <List class="list">
                  {
                    item.list.map(data => (
                      <li
                        onClick={() => {
                          item.setter(data.key)
                          props.onDrawingItemClick({ groupId: DRAWING_GROUP_ID, name: data.key, visible: visible(), lock: lock(), mode: mode() as OverlayMode })
                          setPopoverKey('')
                        }}>
                        <Icon name={data.key}/>
                        <span style="padding-left:8px">{data.text}</span>
                        <button
                          type="button"
                          class="row-star"
                          aria-pressed={props.favorites.includes(data.key)}
                          aria-label={`${i18n('favorite_tool', props.locale)}: ${data.text}`}
                          onClick={event => {
                            event.stopPropagation()
                            props.onToggleFavorite(data.key)
                          }}>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.5l6.1-.7z"/>
                          </svg>
                        </button>
                      </li>
                    ))
                  }
                </List>
              )
            }
          </div>
        ))
      }
      <span class="split-line"/>
      <div
        class="item"
        classList={{ 'popover-open': popoverKey() === 'mode' }}
        tabIndex={0}
        onBlur={() => { setPopoverKey('') }}>
        <span
          role="button"
          tabIndex={0}
          aria-label={modeLabel()}
          aria-pressed={mode() !== 'normal'}
          data-tooltip={modeLabel()}
          class="tool-button"
          classList={{ 'is-active': mode() !== 'normal' }}
          onKeyDown={pressOnKey}
          onClick={() => {
            let currentMode = modeIcon()
            if (mode() !== 'normal') {
              currentMode = 'normal'
            }
            setMode(currentMode)
            props.onModeChange(currentMode)
          }}>
          {
            modeIcon() === 'weak_magnet'
              ? (mode() === 'weak_magnet' ? <Icon name="weak_magnet" class="selected"/> : <Icon name="weak_magnet"/>) 
              : (mode() === 'strong_magnet' ? <Icon name="strong_magnet" class="selected"/> : <Icon name="strong_magnet"/>)
          }
        </span>
        <div
          class="icon-arrow"
          onClick={() => { setPopoverKey(popoverKey() === 'mode' ? '' : 'mode') }}>
          <PopoverArrow open={popoverKey() === 'mode'}/>
        </div>
        {
          popoverKey() === 'mode' && (
            <List class="list">
              {
                modes().map(data => (
                  <li
                    onClick={() => {
                      setModeIcon(data.key)
                      setMode(data.key)
                      props.onModeChange(data.key)
                      setPopoverKey('')
                    }}>
                    <Icon name={data.key}/>
                    <span style="padding-left:8px">{data.text}</span>
                  </li>
                ))
              }
            </List>
          )
        }
      </div>
      <div
        class="item">
        <span
          role="button"
          tabIndex={0}
          aria-label={i18n(lock() ? 'unlock_drawings' : 'lock_drawings', props.locale)}
          aria-pressed={lock()}
          data-tooltip={i18n(lock() ? 'unlock_drawings' : 'lock_drawings', props.locale)}
          class="tool-button"
          classList={{ 'is-active': lock() }}
          onKeyDown={pressOnKey}
          onClick={() => {
            const currentLock = !lock()
            setLock(currentLock)
            props.onLockChange(currentLock)
          }}>
          {
            lock() ? <Icon name="lock"/> : <Icon name="unlock" />
          }
        </span>
      </div>
      <div
        class="item">
        <span
          role="button"
          tabIndex={0}
          aria-label={i18n(visible() ? 'hide_drawings' : 'show_drawings', props.locale)}
          aria-pressed={visible()}
          data-tooltip={i18n(visible() ? 'hide_drawings' : 'show_drawings', props.locale)}
          class="tool-button"
          onKeyDown={pressOnKey}
          onClick={() => {
            const v = !visible()
            setVisible(v)
            props.onVisibleChange(v)
          }}>
          {
            visible() ? <Icon name="visible" /> : <Icon name="invisible" />
          }
        </span>
      </div>
      <div
        class="item">
        <span
          role="button"
          tabIndex={0}
          aria-label={i18n('continuous_drawing', props.locale)}
          aria-pressed={props.continuous}
          data-tooltip={i18n('continuous_drawing', props.locale)}
          class="tool-button"
          classList={{ 'is-active': props.continuous }}
          onKeyDown={pressOnKey}
          onClick={() => { props.onContinuousChange(!props.continuous) }}>
          <Icon name="continuous"/>
        </span>
      </div>
      <span class="split-line"/>
      <div
        class="item">
        <span
          role="button"
          tabIndex={0}
          aria-label={i18n('remove_drawings', props.locale)}
          data-tooltip={i18n('remove_drawings', props.locale)}
          class="tool-button"
          onKeyDown={pressOnKey}
          onClick={() => { props.onRemoveClick(DRAWING_GROUP_ID) }}>
          <Icon name="remove" />
        </span>
      </div>
    </div>
  )
}

export default DrawingBar

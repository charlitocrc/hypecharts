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

import { Period } from './types'

type Nullable<T> = T | null | undefined

const BUFFER_TIMEOUT = 300

const DRAW_KEYS: Record<string, string> = {
  h: 'horizontalStraightLine',
  t: 'straightLine',
  f: 'fibonacciLine',
  v: 'verticalStraightLine'
}

export function matchPeriod (buffer: string, periods: Period[]): Period | null {
  if (buffer.length === 0) {
    return null
  }
  const exact = periods.find(p => p.text === buffer)
  if (exact) {
    return exact
  }
  const lower = buffer.toLowerCase()
  return periods.find(p => p.text.toLowerCase() === lower) ?? null
}

export function isPeriodPrefix (buffer: string, periods: Period[]): boolean {
  if (buffer.length === 0) {
    return false
  }
  const lower = buffer.toLowerCase()
  return periods.some(p => p.text.toLowerCase().startsWith(lower))
}

export function toggleFullScreen (el?: Nullable<HTMLElement>): void {
  const doc = document as any
  if (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? doc.msFullscreenElement) {
    const exit = doc.exitFullscreen ?? doc.msExitFullscreen ?? doc.mozCancelFullScreen ?? doc.webkitExitFullscreen
    exit?.call(doc)
    return
  }
  if (!el) {
    return
  }
  const target = el as any
  const enter = target.requestFullscreen ?? target.webkitRequestFullscreen ?? target.mozRequestFullScreen ?? target.msRequestFullscreen
  enter?.call(target)
}

export function isFullScreen (): boolean {
  const doc = document as any
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? doc.msFullscreenElement)
}

export interface ShortcutHandlers {
  periods: () => Period[]
  isBlocked: () => boolean
  isActive?: () => boolean
  onPeriod: (period: Period) => void
  onBufferChange: (buffer: string) => void
  onEscape: () => boolean
  onDelete: () => void
  onUndo?: () => void
  onRedo?: () => void
  onDraw: (name: string) => void
  onFullScreen: () => void
  onReset: () => void
  onScroll: (direction: number) => void
  onZoom: (direction: number) => void
  onSearch?: () => void
}

function isTypingTarget (target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') {
    return false
  }
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

export function bindShortcuts (handlers: ShortcutHandlers): () => void {
  let buffer = ''
  let timer = 0

  const setBuffer = (next: string) => {
    buffer = next
    handlers.onBufferChange(next)
  }

  const clearBuffer = () => {
    if (timer) {
      window.clearTimeout(timer)
      timer = 0
    }
    if (buffer !== '') {
      setBuffer('')
    }
  }

  const pushBuffer = (ch: string) => {
    const periods = handlers.periods()
    const extended = buffer + ch
    const next = isPeriodPrefix(extended, periods) ? extended : (isPeriodPrefix(ch, periods) ? ch : '')
    if (timer) {
      window.clearTimeout(timer)
      timer = 0
    }
    setBuffer(next)
    if (next === '') {
      return
    }
    const matched = matchPeriod(next, periods)
    if (matched) {
      clearBuffer()
      handlers.onPeriod(matched)
      return
    }
    timer = window.setTimeout(clearBuffer, BUFFER_TIMEOUT)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (handlers.isActive && !handlers.isActive()) return
    const key = e.key
    if (key === 'Escape') {
      clearBuffer()
      if (handlers.onEscape()) e.preventDefault()
      return
    }
    if (isTypingTarget(e.target)) return
    if (e.ctrlKey || e.metaKey) {
      if (handlers.isBlocked() || e.altKey) return
      const lower = key.toLowerCase()
      const action = lower === 'z' ? (e.shiftKey ? handlers.onRedo : handlers.onUndo)
        : lower === 'y' ? handlers.onRedo
        : lower === 'k' ? handlers.onSearch : undefined
      if (action) { e.preventDefault(); clearBuffer(); action() }
      return
    }

    if (handlers.isBlocked()) {
      return
    }

    if (key === '/' && handlers.onSearch) {
      e.preventDefault()
      clearBuffer()
      handlers.onSearch()
      return
    }

    if (e.altKey) {
      const name = DRAW_KEYS[key.toLowerCase()]
      if (name) {
        e.preventDefault()
        clearBuffer()
        handlers.onDraw(name)
      }
      return
    }

    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault()
      clearBuffer()
      handlers.onDelete()
      return
    }

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault()
      handlers.onScroll(key === 'ArrowLeft' ? 1 : -1)
      return
    }

    if (key === '+' || key === '=' || key === '-' || key === '_') {
      e.preventDefault()
      handlers.onZoom(key === '-' || key === '_' ? -1 : 1)
      return
    }

    if (key.length !== 1 || !/[0-9a-z]/i.test(key)) {
      return
    }

    if (buffer === '') {
      const lower = key.toLowerCase()
      if (lower === 'f') {
        e.preventDefault()
        handlers.onFullScreen()
        return
      }
      if (lower === 'r') {
        e.preventDefault()
        handlers.onReset()
        return
      }
    }

    pushBuffer(key)
  }

  document.addEventListener('keydown', onKeyDown)
  return () => {
    if (timer) {
      window.clearTimeout(timer)
    }
    document.removeEventListener('keydown', onKeyDown)
  }
}

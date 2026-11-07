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

import { Component, For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

import { Modal } from '../../component'
import i18n from '../../i18n'
import type { StoredSymbolRecent } from '../../persist'
import type { DatafeedConfiguration, SymbolSearchFilters, SymbolSearchResult } from '../../types'

export interface SymbolSearchModalProps {
  locale: string
  /** Feed capabilities driving the filters; null hides the filter chips. */
  config: DatafeedConfiguration | null
  recents: StoredSymbolRecent[]
  /** 'compare' picks a symbol for a compare series (M5) instead of switching. */
  mode?: 'symbol' | 'compare'
  onSearch: (query: string, filters?: SymbolSearchFilters) => Promise<SymbolSearchResult[]>
  onSelect: (result: SymbolSearchResult) => void
  onClose: () => void
}

type SearchStatus = 'loading' | 'ok' | 'empty' | 'error'

interface ResultRow {
  key: string
  ticker: string
  display: string
  description: string
  exchange: string
  market?: string
  logo?: string
}

interface FlatRow {
  row: ResultRow
  /** Index within the flat list — the listbox ordinal used by keyboard navigation. */
  index: number
  /** Set on the first row of a group to render its header. */
  groupName?: string
  /** Show the exchange badge on the row itself (single-group lists and recents). */
  showBadge: boolean
}

const rowOf = (result: SymbolSearchResult): ResultRow => ({
  key: `${result.exchange.toUpperCase()}:${result.ticker}`,
  ticker: result.ticker,
  display: result.symbol ?? result.ticker,
  description: result.description ?? '',
  exchange: result.exchange,
  market: result.market,
  logo: result.logo
})

const SymbolSearchModal: Component<SymbolSearchModalProps> = props => {
  const [query, setQuery] = createSignal('')
  const [exchangeFilter, setExchangeFilter] = createSignal('')
  const [typeFilter, setTypeFilter] = createSignal('')
  const [results, setResults] = createSignal<ResultRow[]>([])
  const [status, setStatus] = createSignal<SearchStatus>('loading')
  const [activeIndex, setActiveIndex] = createSignal(0)

  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  const delay = () => Math.max(0, props.config?.searchDelayMs ?? 250)

  const runSearch = (text: string, filters?: SymbolSearchFilters): void => {
    const seq = ++searchSeq
    setStatus('loading')
    props.onSearch(text, filters).then(found => {
      if (seq !== searchSeq) return
      setResults(found.map(rowOf))
      setStatus(found.length > 0 ? 'ok' : 'empty')
      setActiveIndex(0)
    }).catch(() => {
      if (seq !== searchSeq) return
      setResults([])
      setStatus('error')
    })
  }

  const scheduleSearch = (text: string): void => {
    if (debounceTimer) clearTimeout(debounceTimer)
    const filters: SymbolSearchFilters = {}
    if (exchangeFilter() !== '') filters.exchange = exchangeFilter()
    if (typeFilter() !== '') filters.type = typeFilter()
    if (delay() === 0) {
      runSearch(text, filters)
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      runSearch(text, filters)
    }, delay())
  }

  onMount(() => { inputRef?.focus() })
  onCleanup(() => { if (debounceTimer) clearTimeout(debounceTimer) })

  // Keep the keyboard-highlighted row visible while navigating.
  createEffect(() => {
    const index = activeIndex()
    listRef?.querySelector(`#symbol-search-option-${index}`)?.scrollIntoView({ block: 'nearest' })
  })

  // Initial view: recents when present, otherwise the first page of results.
  createEffect(() => {
    if (props.recents.length > 0) {
      setStatus('ok')
      setResults([])
      setActiveIndex(0)
    } else {
      runSearch('')
    }
  })

  const showRecents = () => query().trim() === '' && props.recents.length > 0

  // Results grouped by exchange in config order, then flattened so keyboard
  // navigation and rendering share one ordinal list.
  const flat = createMemo<FlatRow[]>(() => {
    if (showRecents()) {
      const recentsLabel = i18n('symbol_search_recents', props.locale)
      return props.recents.map((recent, index) => ({
        row: rowOf({ ticker: recent.ticker, exchange: recent.exchange, symbol: recent.symbol, description: recent.description, market: recent.market, type: recent.type }),
        index,
        ...(index === 0 ? { groupName: recentsLabel } : {}),
        showBadge: true
      }))
    }
    const order = new Map((props.config?.exchanges ?? []).map((exchange, index) => [exchange.key.toUpperCase(), index]))
    const names = new Map((props.config?.exchanges ?? []).map(exchange => [exchange.key.toUpperCase(), exchange.name]))
    const groups = new Map<string, ResultRow[]>()
    results().forEach(row => {
      const key = row.exchange.toUpperCase()
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    })
    const sorted = [...groups.entries()]
      .sort((a, b) => (order.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (order.get(b[0]) ?? Number.MAX_SAFE_INTEGER))
    const multiGroup = sorted.length > 1
    const out: FlatRow[] = []
    sorted.forEach(([key, rows]) => {
      rows.forEach((row, rowIndex) => {
        out.push({
          row,
          index: out.length,
          // The header renders only above the group's first row.
          ...(multiGroup && rowIndex === 0 ? { groupName: names.get(key) ?? key } : {}),
          showBadge: !multiGroup
        })
      })
    })
    return out
  })

  const pick = (row: ResultRow): void => {
    props.onSelect({
      ticker: row.ticker,
      exchange: row.exchange,
      ...(row.display !== row.ticker ? { symbol: row.display } : {}),
      ...(row.description !== '' ? { description: row.description } : {}),
      ...(row.market !== undefined ? { market: row.market } : {})
    })
  }

  const pickActive = (): boolean => {
    const row = flat()[activeIndex()]
    if (!row) return false
    pick(row.row)
    return true
  }

  const moveActive = (delta: number): void => {
    const count = flat().length
    if (count === 0) return
    setActiveIndex(((activeIndex() + delta) % count + count) % count)
  }

  const filterCount = () => (props.config?.exchanges?.length ?? 0) + (props.config?.symbolTypes?.length ?? 0)

  return (
    <Modal
      class="klinecharts-pro-symbol-search-modal"
      title={i18n(props.mode === 'compare' ? 'symbol_search_compare' : 'symbol_search', props.locale)}
      width={520}
      closeOnBackdrop
      onClose={props.onClose}>
      <div class="symbol-search">
        <div class="symbol-search-input">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="6.5"/>
            <path d="M15.5 15.5L21 21"/>
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query()}
            aria-label={i18n('symbol_search', props.locale)}
            placeholder={i18n('symbol_search_placeholder', props.locale)}
            onInput={event => {
              setQuery(event.currentTarget.value)
              scheduleSearch(event.currentTarget.value)
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return }
              if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return }
              if (event.key === 'Enter') {
                event.preventDefault()
                if (pickActive()) props.onClose()
                return
              }
              if (event.key === 'Escape' && query() !== '') {
                event.stopPropagation()
                setQuery('')
                scheduleSearch('')
              }
            }}/>
        </div>
        <Show when={filterCount() > 2}>
          <div class="symbol-search-filters">
            <Show when={(props.config?.exchanges?.length ?? 0) > 1}>
              <For each={props.config?.exchanges ?? []}>
                {exchange => (
                  <button
                    type="button"
                    classList={{ active: exchangeFilter().toUpperCase() === exchange.key.toUpperCase() }}
                    onClick={() => {
                      const next = exchangeFilter().toUpperCase() === exchange.key.toUpperCase() ? '' : exchange.key
                      setExchangeFilter(next)
                      scheduleSearch(query())
                    }}>
                    {exchange.name}
                  </button>
                )}
              </For>
            </Show>
            <Show when={(props.config?.symbolTypes?.length ?? 0) > 1}>
              <For each={props.config?.symbolTypes ?? []}>
                {type => (
                  <button
                    type="button"
                    classList={{ active: typeFilter() === type.key }}
                    onClick={() => {
                      const next = typeFilter() === type.key ? '' : type.key
                      setTypeFilter(next)
                      scheduleSearch(query())
                    }}>
                    {i18n(type.labelKey ?? type.key, props.locale)}
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
        <div
          class="symbol-search-results"
          ref={listRef}
          role="listbox"
          aria-label={i18n('symbol_search', props.locale)}
          aria-activedescendant={flat().length > 0 && status() === 'ok' ? `symbol-search-option-${activeIndex()}` : undefined}>
          <Switch>
            <Match when={status() === 'error'}>
              <div class="symbol-search-state">{i18n('symbol_search_error', props.locale)}</div>
            </Match>
            <Match when={status() === 'loading'}>
              <div class="symbol-search-state">{i18n('symbol_search_loading', props.locale)}</div>
            </Match>
            <Match when={flat().length === 0}>
              <div class="symbol-search-state">{i18n('symbol_search_empty', props.locale)}</div>
            </Match>
            <Match when={true}>
              <For each={flat()}>
                {item => (
                  <>
                    <Show when={item.groupName !== undefined}>
                      <div class="symbol-search-group-title">{item.groupName}</div>
                    </Show>
                    <div
                      id={`symbol-search-option-${item.index}`}
                      class={item.index === activeIndex() ? 'symbol-row active' : 'symbol-row'}
                      role="option"
                      aria-selected={item.index === activeIndex()}
                      aria-label={`${item.row.display} ${item.row.description}`}
                      onMouseEnter={() => setActiveIndex(item.index)}
                      onClick={() => { pick(item.row); props.onClose() }}>
                      <Show when={item.row.logo} fallback={<span class="symbol-logo placeholder" aria-hidden="true">{item.row.display.charAt(0)}</span>}>
                        <img class="symbol-logo" src={item.row.logo} alt=""/>
                      </Show>
                      <span class="symbol-name">{item.row.display}</span>
                      <span class="symbol-description">{item.row.description}</span>
                      <Show when={item.row.market}>
                        <span class="symbol-market">{item.row.market?.toUpperCase()}</span>
                      </Show>
                      <Show when={item.showBadge}>
                        <span class="symbol-exchange">{item.row.exchange}</span>
                      </Show>
                    </div>
                  </>
                )}
              </For>
            </Match>
          </Switch>
        </div>
      </div>
    </Modal>
  )
}

export default SymbolSearchModal

/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { Component, For, Show, createMemo, createSignal } from 'solid-js'

import { Modal } from '../../component'

import i18n from '../../i18n'
import { indicatorType } from '../../persist'
import type { StoredIndicatorTemplate } from '../../persist'
import {
  INDICATOR_MENU_ITEMS, POPULAR_INDICATORS, searchIndicatorItems,
  type IndicatorCategory, type IndicatorMenuItem, type IndicatorPlacement
} from './data'

type CategoryFilter = 'favorites' | 'templates' | 'popular' | 'all' | IndicatorCategory

interface CategoryOption {
  key: CategoryFilter
  localeKey: string
}

  const CATEGORY_OPTIONS: CategoryOption[] = [
    { key: 'popular', localeKey: 'indicator_category_popular' },
    { key: 'trend', localeKey: 'indicator_category_trend' },
    { key: 'momentum', localeKey: 'indicator_category_momentum' },
    { key: 'volatility', localeKey: 'indicator_category_volatility' },
    { key: 'volume', localeKey: 'indicator_category_volume' },
    { key: 'moving_average', localeKey: 'indicator_category_moving_average' },
    { key: 'pattern', localeKey: 'indicator_category_pattern' },
    { key: 'chart_pattern', localeKey: 'indicator_category_chart_pattern' },
    { key: 'all', localeKey: 'indicator_category_all' }
  ]

  const itemsByName = createMemo(() => new Map(INDICATOR_MENU_ITEMS.map(item => [item.name, item])))

export interface IndicatorModalProps {
  locale: string
  mainIndicators: string[]
  subIndicators: Record<string, string>
  favorites: string[]
  templates: StoredIndicatorTemplate[]
  onToggleFavorite: (name: string) => void
  onAddTemplate: (template: StoredIndicatorTemplate, placement: IndicatorPlacement) => void
  onDeleteTemplate: (id: string) => void
  onRenameTemplate: (id: string, name: string) => void
  onAdd: (name: string, placement: IndicatorPlacement) => void
  onClose: () => void
}

const IndicatorModal: Component<IndicatorModalProps> = props => {
  const [activeCategory, setActiveCategory] = createSignal<CategoryFilter>('popular')
  const [query, setQuery] = createSignal('')
  const [renamingTemplateId, setRenamingTemplateId] = createSignal('')
  const [renamingValue, setRenamingValue] = createSignal('')

  const commitRename = (id: string): void => {
    const name = renamingValue().trim()
    if (name !== '') props.onRenameTemplate(id, name)
    setRenamingTemplateId('')
  }

  const favoriteSet = createMemo(() => new Set(props.favorites))

  const categoryOptions = createMemo<CategoryOption[]>(() => {
    const options: CategoryOption[] = []
    if (props.favorites.length > 0) options.push({ key: 'favorites', localeKey: 'indicator_category_favorites' })
    if (props.templates.length > 0) options.push({ key: 'templates', localeKey: 'indicator_category_templates' })
    return [...options, ...CATEGORY_OPTIONS]
  })

  const describe = (item: IndicatorMenuItem): string => {
    const localized = i18n(item.name.toLowerCase(), props.locale)
    if (!localized.toLocaleLowerCase().startsWith(item.name.toLocaleLowerCase())) return localized
    let description = localized.slice(item.name.length).trim()
    if (description.startsWith('(') && description.endsWith(')')) {
      description = description.slice(1, -1).trim()
    }
    return description === '' ? localized : description
  }

  const labels = createMemo(() => new Map(INDICATOR_MENU_ITEMS.map(item => [item.name, describe(item)])))

  const labelFor = (item: IndicatorMenuItem): string => labels().get(item.name) ?? item.name

  const categoryCount = (category: CategoryFilter): number => {
    if (category === 'favorites') return props.favorites.length
    if (category === 'templates') return props.templates.length
    if (category === 'popular') return POPULAR_INDICATORS.length
    if (category === 'all') return INDICATOR_MENU_ITEMS.length
    return INDICATOR_MENU_ITEMS.filter(item => item.category === category).length
  }

  const visibleItems = createMemo(() => {
    const search = query().trim()
    if (search !== '') {
      return searchIndicatorItems(search, labelFor)
    }
    const category = activeCategory()
    if (category === 'favorites') {
      return props.favorites
        .map(name => itemsByName().get(name))
        .filter((item): item is IndicatorMenuItem => item !== undefined)
    }
    if (category === 'templates') return []
    if (category === 'popular') return POPULAR_INDICATORS
    const items = category === 'all'
      ? [...INDICATOR_MENU_ITEMS]
      : INDICATOR_MENU_ITEMS.filter(item => item.category === category)
    return items.sort((a, b) => labelFor(a).localeCompare(labelFor(b)))
  })

  const currentTitle = createMemo(() => {
    if (query().trim() !== '') return i18n('indicator_search_results', props.locale)
    const option = categoryOptions().find(item => item.key === activeCategory())
    return i18n(option?.localeKey ?? 'indicator_category_all', props.locale)
  })

  const placementCount = (name: string, placement: IndicatorPlacement): number =>
    (placement === 'main' ? props.mainIndicators : Object.keys(props.subIndicators))
      .filter(id => indicatorType(id) === name).length

  return (
    <Modal
      class="klinecharts-pro-indicator-modal"
      title={i18n('indicator', props.locale)}
      width={760}
      closeOnBackdrop
      onClose={props.onClose}>
      <div class="klinecharts-pro-indicator-browser">
        <div class="indicator-search">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="6.5"/>
            <path d="M15.5 15.5L21 21"/>
          </svg>
          <input
            type="search"
            value={query()}
            aria-label={i18n('indicator_search', props.locale)}
            placeholder={i18n('indicator_search_placeholder', props.locale)}
            onInput={event => { setQuery(event.currentTarget.value) }}
            onKeyDown={event => {
              if (event.key === 'Escape' && query() !== '') {
                event.stopPropagation()
                setQuery('')
              }
            }}/>
          <Show when={query() !== ''}>
            <button
              type="button"
              class="clear-search"
              aria-label={i18n('indicator_clear_search', props.locale)}
              onClick={() => { setQuery('') }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>
            </button>
          </Show>
        </div>

        <div class="indicator-browser-body">
          <nav class="indicator-category-drawer" aria-label={i18n('indicator_categories', props.locale)}>
            <For each={categoryOptions()}>
              {option => (
                <button
                  type="button"
                  classList={{ active: activeCategory() === option.key && query().trim() === '' }}
                  aria-current={activeCategory() === option.key && query().trim() === '' ? 'page' : undefined}
                  onClick={() => {
                    setActiveCategory(option.key)
                    setQuery('')
                  }}>
                  <span class={`category-mark category-mark-${option.key}`} aria-hidden="true"/>
                  <span class="category-label">{i18n(option.localeKey, props.locale)}</span>
                  <span class="category-count">{categoryCount(option.key)}</span>
                </button>
              )}
            </For>
          </nav>

          <section class="indicator-results" aria-live="polite">
            <div class="indicator-results-header">
              <h3>{currentTitle()}</h3>
              <span>{visibleItems().length}</span>
            </div>
            <div class="indicator-result-list">
              <Show
                when={activeCategory() !== 'templates' ? visibleItems().length > 0 : props.templates.length > 0}
                fallback={(
                  <div class="indicator-empty">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="10.5" cy="10.5" r="6.5"/>
                      <path d="M15.5 15.5L21 21M7.5 10.5H13.5"/>
                    </svg>
                    <span>{i18n('indicator_no_results', props.locale)}</span>
                  </div>
                )}>
                <Show when={activeCategory() === 'templates'} fallback={
                  <For each={visibleItems()}>
                    {item => (
                      <div class="indicator-result-row">
                        <div class="indicator-identity">
                          <span class="indicator-code">{item.name}</span>
                          <Show when={labelFor(item).toLocaleLowerCase() !== item.name.toLocaleLowerCase()}>
                            <span class="indicator-name">{labelFor(item)}</span>
                          </Show>
                        </div>
                        <div class="indicator-placements">
                          <button
                            type="button"
                            class="fav-star"
                            aria-pressed={favoriteSet().has(item.name)}
                            aria-label={`${i18n('indicator_favorite_toggle', props.locale)}: ${labelFor(item)}`}
                            title={i18n('indicator_favorite_toggle', props.locale)}
                            onClick={() => { props.onToggleFavorite(item.name) }}>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M12 3.2l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.5l6.1-.7z"/>
                            </svg>
                          </button>
                          <For each={item.placements}>
                            {placement => {
                              const count = () => placementCount(item.name, placement)
                              const placementLabel = () => i18n(
                                placement === 'main' ? 'indicator_on_chart' : 'indicator_new_pane',
                                props.locale
                              )
                              return (
                                <button
                                  type="button"
                                  class="placement-toggle"
                                  classList={{ active: count() > 0 }}
                                  aria-label={`${i18n('indicator_add', props.locale)} ${placementLabel()}: ${labelFor(item)}${count() > 0 ? ` (${count()})` : ''}`}
                                  onClick={() => { props.onAdd(item.name, placement) }}>
                                  <span class="placement-check" aria-hidden="true">
                                    <Show when={count() > 0} fallback={<svg viewBox="0 0 16 16"><path d="M8 3.5V12.5M3.5 8H12.5"/></svg>}>
                                      {count()}
                                    </Show>
                                  </span>
                                  <span>{placementLabel()}</span>
                                </button>
                              )
                            }}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                }>
                  <For each={props.templates}>
                    {template => (
                      <div class="indicator-result-row indicator-template-row">
                        <div class="indicator-identity">
                          <span class="indicator-code">{template.typeId}</span>
                          <Show when={renamingTemplateId() === template.id} fallback={(
                            <span class="indicator-name">{template.name}</span>
                          )}>
                            <input
                              class="template-rename-input"
                              value={renamingValue()}
                              aria-label={i18n('indicator_template_rename', props.locale)}
                              onInput={event => setRenamingValue(event.currentTarget.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') commitRename(template.id)
                                if (event.key === 'Escape') setRenamingTemplateId('')
                              }}
                              onBlur={() => commitRename(template.id)}/>
                          </Show>
                        </div>
                        <div class="indicator-placements">
                          <For each={(['main', 'sub'] as IndicatorPlacement[])}>
                            {placement => (
                              <button
                                type="button"
                                class="placement-toggle"
                                aria-label={`${i18n('indicator_add', props.locale)}: ${template.name}`}
                                onClick={() => { props.onAddTemplate(template, placement) }}>
                                <span class="placement-check" aria-hidden="true">
                                  <svg viewBox="0 0 16 16"><path d="M8 3.5V12.5M3.5 8H12.5"/></svg>
                                </span>
                                <span>{i18n(placement === 'main' ? 'indicator_on_chart' : 'indicator_new_pane', props.locale)}</span>
                              </button>
                            )}
                          </For>
                          <button
                            type="button"
                            class="template-rename"
                            aria-label={`${i18n('indicator_template_rename', props.locale)}: ${template.name}`}
                            onClick={() => { setRenamingValue(template.name); setRenamingTemplateId(template.id) }}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg>
                          </button>
                          <button
                            type="button"
                            class="template-delete"
                            aria-label={`${i18n('indicator_template_delete', props.locale)}: ${template.name}`}
                            onClick={() => { props.onDeleteTemplate(template.id) }}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18"/></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </section>
        </div>
      </div>
    </Modal>
  )
}

export default IndicatorModal

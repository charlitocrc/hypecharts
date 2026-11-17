import { For, createSignal, onMount, onCleanup } from 'solid-js'
import { Modal } from '../component'
import i18n from '../i18n'
import { createWorkspaceStore } from '../workspace'
import type { ChartWorkspaceState, NamedWorkspace } from '../workspace'

export default function WorkspaceModal (props: {
  locale: string
  capture: () => ChartWorkspaceState[]
  load: (workspace: NamedWorkspace) => Promise<void>
  grid?: () => NamedWorkspace['grid']
  store?: ReturnType<typeof createWorkspaceStore>
  onClose: () => void
}) {
  const store = props.store ?? createWorkspaceStore()
  const [items, setItems] = createSignal<NamedWorkspace[]>([])
  const [selected, setSelected] = createSignal('')
  const [name, setName] = createSignal('')
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const t = (key: string): string => i18n(key, props.locale)
  const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !busy()) { event.preventDefault(); props.onClose() } }
  onMount(() => document.addEventListener('keydown', escape))
  onCleanup(() => document.removeEventListener('keydown', escape))
  const refresh = (): void => { setItems(store.list()) }
  try { refresh() } catch (error) { setError(String(error)) }
  const run = async (action: () => void | Promise<void>): Promise<void> => {
    if (busy()) return
    setBusy(true); setError('')
    try { await action(); refresh() } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  const pick = (id: string): void => { setSelected(id); setName(items().find(item => item.id === id)?.name ?? '') }
  return <Modal class="klinecharts-pro-workspace-modal" width={460} title={t('workspaces')} onClose={() => { if (!busy()) props.onClose() }} closeOnBackdrop={!busy()}>
    <div class="workspace-form" aria-busy={busy()}>
      <label>{t('saved_workspaces')}<select aria-label={t('saved_workspaces')} disabled={busy()} value={selected()} onChange={event => pick(event.currentTarget.value)}>
        <option value="" selected={!selected()}>{t('select_workspace')}</option>
        <For each={items()}>{item => <option value={item.id} selected={selected() === item.id}>{item.name} ({item.charts.length})</option>}</For>
      </select></label>
      <label>{t('workspace_name')}<input aria-label={t('workspace_name')} value={name()} maxLength={80} disabled={busy()} onInput={event => setName(event.currentTarget.value)}/></label>
      <div class="workspace-actions">
        <button type="button" disabled={busy() || !name().trim()} onClick={() => { void run(() => { const item = store.save(name(), props.capture(), props.grid?.()); setSelected(item.id) }) }}>{t('save_new_workspace')}</button>
        <button type="button" disabled={busy() || !selected() || !name().trim()} onClick={() => { void run(() => { store.save(name(), props.capture(), props.grid?.(), selected()) }) }}>{t('update_workspace')}</button>
        <button type="button" disabled={busy() || !selected()} onClick={() => { void run(async () => {
          const item = store.list().find(item => item.id === selected())
          if (!item) throw new Error(t('select_workspace'))
          await props.load(item)
          props.onClose()
        }) }}>{t('load_workspace')}</button>
        <button type="button" disabled={busy() || !selected() || !name().trim()} onClick={() => { void run(() => { store.rename(selected(), name()) }) }}>{t('rename_workspace')}</button>
        <button type="button" disabled={busy() || !selected()} onClick={() => { void run(() => { store.remove(selected()); pick('') }) }}>{t('delete_workspace')}</button>
        <button type="button" disabled={busy()} onClick={props.onClose}>{t('close')}</button>
      </div>
      <p>{t('workspaces_local')}</p>
      <ShowError message={error()}/>
    </div>
  </Modal>
}
function ShowError (props: { message: string }) { return <p role="alert">{props.message}</p> }

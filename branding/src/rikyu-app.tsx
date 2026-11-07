import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react'
import './rikyu-app.css'

export type Params = Record<string, string | number | boolean | null>
interface Entry {
  name: string
  params: Params
  key: number
}
interface NavState {
  tab?: string
  stacks: Record<string, { name: string; params: Params }[]>
}
declare global {
  interface Window {
    __rkNav?: { initial?: NavState | null; save(state: NavState): void }
  }
}

// ---- Physics model ----

// Deceleration rate per ms. Same as UIScrollView.DecelerationRate.normal
const DECELERATION = 0.998
// Resistance when pulled past the edge. Same coefficient as UIScrollView's rubber band
function rubberBand(offset: number, dimension: number) {
  if (!dimension) return 0
  const x = Math.abs(offset)
  return Math.sign(offset) * (1 - 1 / ((x * 0.55) / dimension + 1)) * dimension
}

/** Animate from `from` to `to` with a critically damped spring. velocity is change per ms, carrying over the momentum from release */
function spring(
  from: number,
  to: number,
  velocity: number,
  response: number,
  update: (value: number) => void,
  done?: () => void
) {
  const omega = (2 * Math.PI) / response
  const x0 = from - to
  const b = velocity + omega * x0
  const start = performance.now()
  let frame = requestAnimationFrame(function step(now) {
    const t = now - start
    const decay = Math.exp(-omega * t)
    const x = (x0 + b * t) * decay
    const v = (velocity - omega * b * t) * decay
    if (Math.abs(x) < 0.1 && Math.abs(v) < 0.001) {
      update(to)
      done?.()
      return
    }
    update(to + x)
    frame = requestAnimationFrame(step)
  })
  return () => cancelAnimationFrame(frame)
}

/** Compute velocity per ms from the most recent movement */
function velocityOf(samples: { t: number; p: number }[]) {
  const last = samples.at(-1)
  if (!last) return 0
  const first = samples.find((sample) => last.t - sample.t < 100) ?? last
  const dt = last.t - first.t
  return dt > 0 ? (last.p - first.p) / dt : 0
}

// Among nested scrollers and the back swipe, only the first whose direction matches gets the pointer
const gesture: { owner: object | null } = { owner: null }

function isEditable(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]')
}

/** Swallow the click right after a drag so it doesn't reach buttons and the like */
function swallowClick(element: HTMLElement) {
  const stop = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
  }
  element.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => element.removeEventListener('click', stop, { capture: true }), 0)
}

// ---- Transition state persistence ----

const navState: NavState = { stacks: {} }
const initialNav = typeof window === 'undefined' ? null : (window.__rkNav?.initial ?? null)
function persist() {
  if (typeof window !== 'undefined') window.__rkNav?.save(JSON.parse(JSON.stringify(navState)))
}
const rootResets = new Map<string, () => void>()

// ---- ScrollView ----

interface ScrollViewProps {
  children?: ReactNode
  horizontal?: boolean
  className?: string
  style?: CSSProperties
  contentClassName?: string
  contentStyle?: CSSProperties
}

/** Scroll area that, like iOS, follows the finger, glides with inertia on release and bounces at the edges */
export function ScrollView({
  children,
  horizontal = false,
  className,
  style,
  contentClassName,
  contentStyle,
}: ScrollViewProps) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = outer.current
    const content = inner.current
    if (!element || !content) return
    const token = {}
    let position = 0,
      limit = 0,
      stop = () => {},
      wheelOver = 0,
      wheelTimer: ReturnType<typeof setTimeout> | undefined
    let drag: {
      id: number
      x: number
      y: number
      start: number
      moved: boolean
      samples: { t: number; p: number }[]
    } | null = null
    const size = () => (horizontal ? element.clientWidth : element.clientHeight)
    const native = () => (horizontal ? element.scrollLeft : element.scrollTop)
    const measure = () =>
      Math.max(
        0,
        horizontal
          ? element.scrollWidth - element.clientWidth
          : element.scrollHeight - element.clientHeight
      )
    const render = (value: number) => {
      position = value
      const clamped = Math.min(Math.max(value, 0), limit)
      if (horizontal) element.scrollLeft = clamped
      else element.scrollTop = clamped
      const over = value - clamped
      content.style.transform = over
        ? horizontal
          ? 'translate3d(' + -over + 'px,0,0)'
          : 'translate3d(0,' + -over + 'px,0)'
        : ''
    }
    // When at rest, the browser's scroll position is authoritative
    const settle = () => {
      stop()
      stop = () => {}
      if (!content.style.transform) position = native()
      limit = measure()
    }
    const bounceBack = (velocity: number) => {
      const edge = position < 0 ? 0 : limit
      stop = spring(position, edge, velocity, 400, render)
    }
    const glide = (initial: number) => {
      let velocity = initial,
        last = performance.now(),
        frame = 0
      const step = (now: number) => {
        const dt = Math.min(now - last, 32)
        last = now
        const next = position + velocity * dt
        velocity *= Math.pow(DECELERATION, dt)
        if (next < 0 || next > limit) {
          render(next)
          bounceBack(velocity)
          return
        }
        render(next)
        if (Math.abs(velocity) > 0.02) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
      stop = () => cancelAnimationFrame(frame)
    }
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (isEditable(event.target)) return
      settle()
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        start: position,
        moved: false,
        samples: [],
      }
    }
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 6) return
        const along = horizontal ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx)
        // Horizontal scroll only when there is overflow; vertical can always be pulled, like iOS lists
        if (!along || gesture.owner || (horizontal && limit <= 0)) {
          drag = null
          return
        }
        gesture.owner = token
        drag.moved = true
        element.setPointerCapture(event.pointerId)
        document.documentElement.style.userSelect = 'none'
      }
      const raw = drag.start - (horizontal ? dx : dy)
      render(raw < 0 ? rubberBand(raw, size()) : raw > limit ? limit + rubberBand(raw - limit, size()) : raw)
      drag.samples.push({ t: event.timeStamp, p: -(horizontal ? event.clientX : event.clientY) })
      if (drag.samples.length > 12) drag.samples.shift()
    }
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const moved = drag.moved,
        velocity = velocityOf(drag.samples)
      drag = null
      if (!moved) return
      if (gesture.owner === token) gesture.owner = null
      document.documentElement.style.userSelect = ''
      swallowClick(element)
      if (position < 0 || position > limit) bounceBack(velocity)
      else glide(velocity)
    }
    const wheel = (event: WheelEvent) => {
      const delta = horizontal ? event.deltaX : event.deltaY
      if (!delta) return
      if (!wheelOver) settle()
      const current = native()
      if (wheelOver || (current <= 0 && delta < 0) || (current >= limit && delta > 0)) {
        const edge = wheelOver ? (wheelOver < 0 ? 0 : limit) : delta < 0 ? 0 : limit
        wheelOver += delta
        if ((edge === 0 && wheelOver > 0) || (edge === limit && wheelOver < 0)) wheelOver = 0
        render(edge + rubberBand(wheelOver, size()) * 0.5)
        clearTimeout(wheelTimer)
        wheelTimer = setTimeout(() => {
          wheelOver = 0
          bounceBack(0)
        }, 90)
      }
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('wheel', wheel, { passive: true })
    return () => {
      stop()
      clearTimeout(wheelTimer)
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('wheel', wheel)
    }
  }, [horizontal])
  return (
    <div
      ref={outer}
      className={className}
      style={{
        overflowX: horizontal ? 'auto' : 'hidden',
        overflowY: horizontal ? 'hidden' : 'auto',
        overscrollBehavior: 'none',
        touchAction: 'none',
        ...style,
      }}
    >
      <div
        ref={inner}
        className={contentClassName}
        style={{
          display: horizontal ? 'flex' : 'block',
          width: horizontal ? 'max-content' : undefined,
          minHeight: horizontal ? undefined : '100%',
          willChange: 'transform',
          ...contentStyle,
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ---- Stack ----

interface StackApi {
  push(name: string, params?: Params): void
  pop(): void
  params: Params
  canGoBack: boolean
}
const ScreenContext = createContext<StackApi | null>(null)
const TabContext = createContext<string | null>(null)

/** From the current screen, get push/pop navigation and the params passed to the screen */
export function useStack(): StackApi {
  const api = useContext(ScreenContext)
  if (!api) throw new Error('useStack must be used inside a Stack screen')
  return api
}

interface StackProps {
  screens: Record<string, ComponentType<{ params: Params }>>
  initial: string
  initialParams?: Params
  id?: string
}

/** Screen stack that, like iOS navigation, pushes in from the right and pops via a left-edge swipe or pop */
export function Stack({ screens, initial, initialParams = {}, id = 'stack' }: StackProps) {
  const tab = useContext(TabContext)
  const stackId = (tab ?? 'root') + ':' + id
  const counter = useRef(0)
  const [entries, setEntries] = useState<Entry[]>(() => {
    const saved = initialNav?.stacks[stackId]?.filter((entry) => entry.name in screens)
    const list = saved?.length ? saved : [{ name: initial, params: initialParams }]
    return list.map((entry) => ({ ...entry, key: counter.current++ }))
  })
  const container = useRef<HTMLDivElement>(null)
  const layers = useRef(new Map<number, HTMLDivElement>())
  const shades = useRef(new Map<number, HTMLDivElement>())
  const progress = useRef(0)
  const entering = useRef(false)
  const stop = useRef(() => {})

  // progress is how far the top screen has slid off to the right. 0 is fully shown, 1 fully hidden
  const apply = (value: number, list = entries) => {
    progress.current = value
    const width = container.current?.clientWidth ?? 0
    list.forEach((entry, index) => {
      const layer = layers.current.get(entry.key),
        shade = shades.current.get(entry.key)
      if (!layer) return
      const depth = list.length - 1 - index
      layer.style.visibility = depth <= 1 ? 'visible' : 'hidden'
      layer.style.transform =
        depth === 0
          ? 'translate3d(' + value * width + 'px,0,0)'
          : depth === 1
            ? 'translate3d(' + -0.3 * width * (1 - value) + 'px,0,0)'
            : ''
      layer.style.boxShadow =
        depth === 0 && list.length > 1 ? '0 0 24px rgba(0,0,0,' + 0.16 * (1 - value) + ')' : ''
      if (shade) shade.style.opacity = depth === 1 ? String(0.1 * (1 - value)) : '0'
    })
  }

  useEffect(() => {
    navState.stacks[stackId] = entries.map(({ name, params }) => ({ name, params }))
    persist()
  }, [entries, stackId])

  // Re-lay out only when the stack changes, so mid-gesture re-renders don't reset positions
  useLayoutEffect(() => {
    if (!entering.current) {
      apply(0)
      return
    }
    entering.current = false
    apply(1)
    stop.current = spring(1, 0, 0, 500, (value) => apply(value))
  }, [entries])

  const finishPop = (velocity: number) => {
    stop.current()
    stop.current = spring(progress.current, 1, velocity, 500, apply, () =>
      setEntries((list) => list.slice(0, -1))
    )
  }

  const api = useRef({ entries, finishPop })
  api.current = { entries, finishPop }

  useEffect(() => {
    rootResets.set(stackId, () =>
      setEntries((list) => {
        stop.current()
        return list.slice(0, 1)
      })
    )
    return () => {
      rootResets.delete(stackId)
    }
  }, [stackId])

  // Swipe right from the left edge to go back. Checked before inner scrollers so back takes priority, like iOS
  useEffect(() => {
    const element = container.current
    if (!element) return
    const token = {}
    let drag: { id: number; x: number; y: number; moved: boolean; samples: { t: number; p: number }[] } | null = null
    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (api.current.entries.length < 2) return
      if (event.clientX - element.getBoundingClientRect().left > 20) return
      gesture.owner = null
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, samples: [] }
    }
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < 6) return
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx) || gesture.owner) {
          drag = null
          return
        }
        gesture.owner = token
        drag.moved = true
        stop.current()
        element.setPointerCapture(event.pointerId)
        document.documentElement.style.userSelect = 'none'
      }
      event.stopPropagation()
      apply(Math.min(Math.max(dx / element.clientWidth, 0), 1), api.current.entries)
      drag.samples.push({ t: event.timeStamp, p: event.clientX / element.clientWidth })
      if (drag.samples.length > 12) drag.samples.shift()
    }
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return
      const moved = drag.moved,
        velocity = velocityOf(drag.samples)
      drag = null
      if (!moved) return
      if (gesture.owner === token) gesture.owner = null
      document.documentElement.style.userSelect = ''
      swallowClick(element)
      if (progress.current > 0.5 || velocity > 0.0015) api.current.finishPop(velocity)
      else {
        stop.current()
        stop.current = spring(progress.current, 0, velocity, 500, (value) =>
          apply(value, api.current.entries)
        )
      }
    }
    element.addEventListener('pointerdown', down, { capture: true })
    element.addEventListener('pointermove', move, { capture: true })
    element.addEventListener('pointerup', up, { capture: true })
    element.addEventListener('pointercancel', up, { capture: true })
    return () => {
      element.removeEventListener('pointerdown', down, { capture: true })
      element.removeEventListener('pointermove', move, { capture: true })
      element.removeEventListener('pointerup', up, { capture: true })
      element.removeEventListener('pointercancel', up, { capture: true })
    }
  }, [])

  useEffect(() => () => stop.current(), [])

  return (
    <div
      ref={container}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      {entries.map((entry, index) => (
        <Screen
          key={entry.key}
          entry={entry}
          Component={screens[entry.name]}
          canGoBack={index > 0}
          push={(name, params = {}) => {
            stop.current()
            entering.current = true
            setEntries((list) => [...list, { name, params, key: counter.current++ }])
          }}
          pop={() => {
            if (index > 0 && index === api.current.entries.length - 1) finishPop(0)
          }}
          layer={(element) => {
            if (element) layers.current.set(entry.key, element)
            else layers.current.delete(entry.key)
          }}
          shade={(element) => {
            if (element) shades.current.set(entry.key, element)
            else shades.current.delete(entry.key)
          }}
        />
      ))}
    </div>
  )
}

function Screen({
  entry,
  Component,
  canGoBack,
  push,
  pop,
  layer,
  shade,
}: {
  entry: Entry
  Component: ComponentType<{ params: Params }> | undefined
  canGoBack: boolean
  push: StackApi['push']
  pop: StackApi['pop']
  layer: (element: HTMLDivElement | null) => void
  shade: (element: HTMLDivElement | null) => void
}) {
  const pushRef = useRef(push),
    popRef = useRef(pop)
  pushRef.current = push
  popRef.current = pop
  const api = useMemo<StackApi>(
    () => ({
      push: (name, params) => pushRef.current(name, params),
      pop: () => popRef.current(),
      params: entry.params,
      canGoBack,
    }),
    [entry.params, canGoBack]
  )
  return (
    <div
      ref={layer}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--rk-screen-background, #fff)',
        willChange: 'transform',
      }}
    >
      <ScreenContext value={api}>{Component ? <Component params={entry.params} /> : null}</ScreenContext>
      <div
        ref={shade}
        style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none' }}
      />
    </div>
  )
}

// ---- TabView ----

interface Tab {
  id: string
  label: string
  icon: ReactNode
  content: ReactNode
}
interface TabViewProps {
  tabs: Tab[]
  tint?: string
  appearance?: 'light' | 'dark'
  initial?: string
}

// Tab bar strip height and its gap to the home indicator. Screens reserve bottom space via --rk-tab-bar-height
const BAR_HEIGHT = 62,
  BAR_BOTTOM = 21

/** Floating glass tab bar at the bottom, like iOS 26. Each tab keeps its screens and transitions when switching */
export function TabView({ tabs, tint = '#007aff', appearance = 'light', initial }: TabViewProps) {
  const [selected, setSelected] = useState(() => {
    const saved = initialNav?.tab
    return tabs.some((tab) => tab.id === saved) ? saved! : (initial ?? tabs.at(0)?.id ?? '')
  })
  const [visited, setVisited] = useState(() => new Set([selected]))
  useEffect(() => {
    navState.tab = selected
    persist()
  }, [selected])
  const dark = appearance === 'dark'
  const select = (id: string) => {
    // Tapping the active tab again returns to that tab's first screen, like iOS
    if (id === selected) {
      for (const [key, reset] of rootResets) if (key.startsWith(id + ':')) reset()
      return
    }
    setSelected(id)
    setVisited((set) => new Set(set).add(id))
  }
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ['--rk-tab-bar-height' as string]: BAR_HEIGHT + BAR_BOTTOM + 12 + 'px',
      }}
    >
      {tabs.map((tab) =>
        visited.has(tab.id) ? (
          <div
            key={tab.id}
            style={{
              position: 'absolute',
              inset: 0,
              // Hide the whole branch so visibility:visible inside the Stack doesn't re-show unselected tabs
              display: tab.id === selected ? 'block' : 'none',
            }}
          >
            <TabContext value={tab.id}>{tab.content}</TabContext>
          </div>
        ) : null
      )}
      <nav
        style={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: BAR_BOTTOM,
          height: BAR_HEIGHT,
          display: 'flex',
          padding: 4,
          borderRadius: BAR_HEIGHT / 2,
          background: dark ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: dark ? '0.5px solid rgba(255,255,255,0.12)' : '0.5px solid rgba(0,0,0,0.06)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === selected
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => select(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                border: 0,
                borderRadius: (BAR_HEIGHT - 8) / 2,
                background: active ? (dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)') : 'transparent',
                color: active ? tint : dark ? '#f2f2f7' : '#1c1c1e',
                font: '600 10px/12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
                cursor: 'pointer',
                transition: 'background-color 200ms, color 200ms',
              }}
            >
              <span style={{ display: 'flex', fontSize: 24, lineHeight: 1 }}>{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </nav>
    </div>
  )
}

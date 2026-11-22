import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'

// This suite pins down the superset stepper regression: one tap on a +/- button must move the
// value by exactly one step. The bug was a stale closure — in a superset both ExerciseBlock
// instances share the same store subscription, so updating one member's field re-renders the
// partner and replaces the render-time `s` snapshot the button handler had closed over. The
// fix reads the current value from the store at call time. The mocked `update` below clones the
// whole state on every write (structuredClone), which is exactly what invalidates those
// snapshots, so this environment reproduces the original two-taps-per-increment behaviour.
const mocks = vi.hoisted(() => {
  const state = {
    S: null,
    startRest: vi.fn(),
    stopRest: vi.fn(),
    stopWork: vi.fn(),
    toast: vi.fn(),
  }
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  state.uiSnapshot = () => ({
    timer: null,
    work: null,
    startRest: state.startRest,
    stopRest: state.stopRest,
    stopWork: state.stopWork,
    shiftRestOwner: vi.fn(),
    startWork: vi.fn(),
    toast: state.toast,
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot()
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(),
  exercisePicker: vi.fn(),
  exConfigSheet: vi.fn(),
  exerciseDetailSheet: vi.fn(),
  finishWorkout: vi.fn(),
  finishWorkoutSheet: vi.fn(),
  workoutCompleteSheet: vi.fn(),
  confirmSheet: vi.fn(),
  swapActiveWorkoutExercise: vi.fn(),
  barWeightSheet: vi.fn(),
  exerciseNoteSheet: vi.fn(),
  sessionNoteSheet: vi.fn(),
  renameWorkoutSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))

let dom
let root
let container

function exercise(id, sets, extra = {}) {
  return {
    id,
    target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
    sets: sets.map(done => ({ w: 60, r: 5, done })),
    ...extra,
  }
}

function workout(entries, cur = 0) {
  return {
    unit: 'kg', restSec: 90, sound: false, effort: 'none', gifSize: 'full',
    workouts: [], exWeights: {}, routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur, entries },
  }
}

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  dom.Element.prototype.scrollIntoView = vi.fn()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

async function mount(entries, cur = 0) {
  mocks.S = workout(entries, cur)
  installDom()
  await act(async () => { root.render(React.createElement(Workout)) })
}

async function unmount() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
  dom = null
}

// The +/- controls live in `.stp` cells, one per editable column. For a plain reps set the
// order is [weight, reps]; this returns the Increase/Decrease button for a given column of a
// given set row inside a given exercise block (addressed by its data-exidx wrapper).
function stepperButton(exidx, setRow, col, direction) {
  const block = container.querySelector(`[data-exidx="${exidx}"]`)
  expect(block).toBeTruthy()
  const row = block.querySelectorAll('.setrow')[setRow]
  expect(row).toBeTruthy()
  const cell = row.querySelectorAll('.stp')[col]
  expect(cell).toBeTruthy()
  return cell.querySelector(`button[aria-label*=": ${direction}"]`)
}

async function tap(button) {
  expect(button).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.Event('click', { bubbles: true })) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await unmount()
})

describe('superset stepper — one tap moves one step', () => {
  it('keeps the completion control at 48px for the supported phone widths', () => {
    const css = readFileSync(new URL('../saymongym.css', import.meta.url), 'utf8')
    const compactRule = css.match(/@media \(max-width: 430px\)\s*\{\s*body\.no-tabbar \.setrow \.set-check \{([^}]+)\}/s)?.[1] || ''
    const baseRule = css.match(/body\.no-tabbar \.setrow \{([^}]+)\}/)?.[1] || ''
    const currentRule = css.match(/body\.no-tabbar \.setrow\.is-current \{([^}]+)\}/)?.[1] || ''
    const wrapRule = css.match(/@media \(max-width: 412px\)\s*\{\s*body\.no-tabbar \.setrow \{([^}]+)\}/s)?.[1] || ''
    expect(compactRule).toContain('flex-basis: 48px')
    expect(compactRule).toContain('width: 48px')
    expect(baseRule).toContain('box-sizing: border-box')
    expect(baseRule).toContain('padding-inline-end: 12px')
    expect(baseRule).toContain('border: 1px solid transparent')
    expect(currentRule).toContain('border-color: var(--acc-line)')
    expect(currentRule).not.toContain('margin')
    expect(currentRule).not.toContain('outline')
    expect(wrapRule).toContain('flex-wrap: wrap')
    expect([360, 375, 393, 412, 430].map(width => width <= 412)).toEqual([true, true, true, true, false])
  })

  it('highlights the next unfinished set and lets its clear completion button be undone', async () => {
    await mount([exercise('press', [true, false, false])])
    const rows = container.querySelectorAll('.setrow')
    expect(rows[0].classList.contains('is-current')).toBe(false)
    expect(rows[1].classList.contains('is-current')).toBe(true)
    expect(rows[2].classList.contains('is-current')).toBe(false)

    const complete = rows[1].querySelector('.set-check')
    expect(complete.textContent).toContain('Log set')
    expect(complete.getAttribute('aria-label')).toContain('Log set')
    await tap(complete)
    expect(mocks.S.active.entries[0].sets[1].done).toBe(true)
    await act(async () => { root.render(React.createElement(Workout)) })

    const undo = container.querySelectorAll('.setrow')[1].querySelector('.set-check')
    expect(undo.textContent).toContain('Done')
    expect(undo.getAttribute('aria-label')).toContain('Undo')
    await tap(undo)
    expect(mocks.S.active.entries[0].sets[1].done).toBe(false)
  })

  // Weight steps by 2.5. A single tap on the first exercise of a superset must land on 62.5,
  // not stay at 60 waiting for a second tap.
  it('increments a superset member weight by one step per tap', async () => {
    await mount([
      exercise('press', [false], { sg: 'group' }),
      exercise('row', [false], { sg: 'group' }),
    ])

    await tap(stepperButton(0, 0, 0, 'Increase'))

    expect(mocks.S.active.entries[0].sets[0].w).toBe(62.5)
  })

  // Reps step by 1 and do not cascade, so they isolate the stepper from weight's carry-through.
  // Three taps must reach 8 (5 -> 6 -> 7 -> 8); the stale closure made every tap after the
  // first re-apply against last render's value, so the count would lag behind the taps.
  it('advances reps by exactly one per tap across repeated taps', async () => {
    await mount([
      exercise('press', [false], { sg: 'group' }),
      exercise('row', [false], { sg: 'group' }),
    ])

    await tap(stepperButton(0, 0, 1, 'Increase'))
    await tap(stepperButton(0, 0, 1, 'Increase'))
    await tap(stepperButton(0, 0, 1, 'Increase'))

    expect(mocks.S.active.entries[0].sets[0].r).toBe(8)
  })

  // The partner exercise shares the subscription that gets replaced on every write. Tapping its
  // stepper after the first exercise has already been bumped must still act on the partner's own
  // current value, not a snapshot from before the clone.
  it('steps the partner exercise correctly after the first member was changed', async () => {
    await mount([
      exercise('press', [false], { sg: 'group' }),
      exercise('row', [false], { sg: 'group' }),
    ])

    await tap(stepperButton(0, 0, 1, 'Increase'))
    await tap(stepperButton(1, 0, 1, 'Increase'))

    expect(mocks.S.active.entries[0].sets[0].r).toBe(6)
    expect(mocks.S.active.entries[1].sets[0].r).toBe(6)
  })

  // Decrement walks the same path and must not undershoot or need a double tap either.
  it('decrements a superset member weight by one step per tap', async () => {
    await mount([
      exercise('press', [false], { sg: 'group' }),
      exercise('row', [false], { sg: 'group' }),
    ])

    await tap(stepperButton(0, 0, 0, 'Decrease'))

    expect(mocks.S.active.entries[0].sets[0].w).toBe(57.5)
  })
})

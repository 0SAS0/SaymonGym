// @vitest-environment happy-dom
// The finish summary's Share (v1.4.5): right next to the way out, which stays right under the
// numbers, and it opens the same picture sheet as History's "Share as image".
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkoutNow } from './sheets.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
let host
function renderTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const settle = () => act(async () => {})

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'Push A', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }]
  st.active = { id: 'fin', d: '2026-09-28', start: Date.now() - 20 * 60000, routineIds: ['r1'], routineId: 'r1', name: 'Push A', bw: null, cur: 0,
    entries: [{ id: '0025', rid: 'r1', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }] }
  useStore.setState({ S: st, user: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('finish summary: Share', () => {
  it('sits beside the way out, which still comes right after the numbers', async () => {
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    const row = host.querySelector('.fin-actions')
    expect(row).toBeTruthy()
    const [done, share] = row.querySelectorAll('button')
    expect(done.textContent).toBe('Nice!')
    expect(share.textContent).toBe('Share')
    // Nothing but the numbers and the records list between the title and the way out.
    const tiles = host.querySelector('.tiles.fin')
    expect(tiles.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelector('.bodymap, [data-keep-in-routine]')?.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('opens the picture sheet for the saved workout: four templates, three sizes, three looks', async () => {
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    const before = useUI.getState().sheets.length
    act(() => host.querySelector('[data-fin-share]').click())
    expect(useUI.getState().sheets.length).toBe(before + 1)
    renderTopSheet()
    await settle()
    expect(host.querySelector('h3').textContent).toBe('Share workout')
    expect([...host.querySelectorAll('.sharew-tpl button')].map(b => b.textContent)).toEqual(['Classic', 'Photo', 'Lifts', 'Sticker'])
    const labels = [...host.querySelectorAll('.share-opts button')].map(b => b.textContent)
    expect(labels).toEqual(['Story 9:16', 'Portrait 4:5', 'Square 1:1', 'Dark', 'Light', 'Accent'])
  })

  it('names the workout, keeps the three summary values and map, and says nothing about absent PRs', async () => {
    // A previous, higher result means this session has no record under the existing rules.
    useStore.getState().S.workouts = [{ id: 'prior', d: '2026-09-01', start: Date.now() - 86400000, end: Date.now() - 86000000,
      entries: [{ id: '0025', sets: [{ w: 70, r: 5, done: true }] }] }]
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    const summary = host.querySelector('[data-finish-summary]')
    expect(summary.querySelector('.finish-workout-name').textContent).toBe('Push A')
    expect(summary.querySelectorAll('[data-finish-stats] .tile')).toHaveLength(4)
    expect(summary.querySelector('.finish-muscles .finish-map')).toBeTruthy()
    expect(summary.querySelector('[data-finish-records]')).toBeNull()
    expect(summary.querySelector('.finish-stats .tile.narrow .v').textContent).toBe('–')
    expect(summary.querySelectorAll('.fin-actions button')[0].textContent).toBe('Nice!')
  })

  it('shows established records from the existing finish calculation', async () => {
    const st = useStore.getState().S
    st.workouts = [{ id: 'prior', d: '2026-09-01', start: Date.now() - 86400000, end: Date.now() - 86000000,
      entries: [{ id: '0025', sets: [{ w: 50, r: 5, done: true }] }] }]
    act(() => finishWorkoutNow())
    const prHost = renderTopSheet()
    await settle()
    expect(useStore.getState().S.workouts.at(-1).prs).toContain('0025')
    const records = prHost.querySelector('[data-finish-records]')
    expect(records).toBeTruthy()
    expect(records?.textContent).toContain('New PR:')
  })

  it('renders zero completed sets and zero volume without inventing a record', async () => {
    const st = useStore.getState().S
    st.active.entries[0].sets = []
    act(() => finishWorkoutNow())
    renderTopSheet()
    await settle()
    const summary = host.querySelector('[data-finish-summary]')
    expect(summary.querySelector('.finish-stats .tile.wide .v').textContent).toContain('0')
    expect(summary.querySelector('.finish-stats .tile:nth-child(2) .v').textContent).toContain('0')
    expect(summary.querySelector('[data-finish-records]')).toBeNull()
  })
})

import { RESIDENTS } from '../game/residents'
export interface JournalSave {
  met: string[]
  shared: string[]
}
const KEY = 'lammy-neighbours-v1'
let volatile = false
let memory: JournalSave = { met: [], shared: [] }
export function readJournal(): JournalSave {
  if (volatile) return memory
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return memory
    const shared = RESIDENTS.filter(
      (r) => Array.isArray(raw.shared) && raw.shared.includes(r.id),
    ).map((r) => r.id)
    const met = RESIDENTS.filter(
      (r) =>
        shared.includes(r.id) ||
        (Array.isArray(raw.met) && raw.met.includes(r.id)),
    ).map((r) => r.id)
    memory = { met, shared }
  } catch {
    /* The journal remains usable for this session if storage is unavailable. */
  }
  return memory
}
export function rememberResident(id: string, shared: boolean): boolean {
  if (!RESIDENTS.some((r) => r.id === id)) return false
  const before = readJournal()
  memory = {
    met: [...new Set([...before.met, id])],
    shared: [...new Set([...before.shared, ...(shared ? [id] : [])])],
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
    volatile = false
    return true
  } catch {
    volatile = true
    return false
  }
}

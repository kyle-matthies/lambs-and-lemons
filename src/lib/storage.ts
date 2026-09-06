import { CHAPTERS, FIRST_CHAPTER, nextChapter } from '../game/campaign'
import type { BestRound, RoundMinutes } from '../game/types'

export type BestByRound = Partial<Record<RoundMinutes, BestRound>>

export interface LeaderboardEntry {
  sold: number
  score: number
  minutes: RoundMinutes
  sparkleCups: number
  at: number
}

export type DecorationId = 'flowers' | 'bunting' | 'umbrella' | 'sign'

export interface TycoonSave {
  purse: number
  day: number
  decorations: DecorationId[]
}

const BEST_KEY = 'lammy-best-v1'
const BOARD_KEY = 'lammy-board-v1'
const MUTE_KEY = 'lammy-mute-v1'
const TYCOON_KEY = 'lammy-tycoon-v1'
const QUALITY_KEY = 'lammy-quality-v1'
const LEADERBOARD_SIZE = 8

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be unavailable (private mode); the game still works.
  }
}

export function readBestScores(): BestByRound {
  return readJson<BestByRound>(BEST_KEY, {})
}

export function recordBestRound(
  existing: BestByRound,
  roundMinutes: RoundMinutes,
  sold: number,
  score: number,
): { best: BestByRound; isNewBest: boolean } {
  const current = existing[roundMinutes] ?? { sold: 0, score: 0 }
  const isNewBest =
    (sold > 0 || score > 0) &&
    (sold > current.sold || (sold === current.sold && score > current.score))
  if (!isNewBest) return { best: existing, isNewBest: false }

  const best = { ...existing, [roundMinutes]: { sold, score } }
  writeJson(BEST_KEY, best)
  return { best, isNewBest: true }
}

export function readLeaderboard(): LeaderboardEntry[] {
  return readJson<LeaderboardEntry[]>(BOARD_KEY, [])
}

export function recordLeaderboard(entry: LeaderboardEntry): LeaderboardEntry[] {
  const board = [...readLeaderboard(), entry]
    .sort((a, b) => b.sold - a.sold || b.score - a.score || a.at - b.at)
    .slice(0, LEADERBOARD_SIZE)
  writeJson(BOARD_KEY, board)
  return board
}

export function readMuted(): boolean {
  return readJson<boolean>(MUTE_KEY, false)
}

export function writeMuted(muted: boolean) {
  writeJson(MUTE_KEY, muted)
}

export type QualityChoice = 'auto' | 'low' | 'medium' | 'high'

export function readQuality(): QualityChoice {
  const value = readJson<QualityChoice>(QUALITY_KEY, 'auto')
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : 'auto'
}

export function writeQuality(choice: QualityChoice) {
  writeJson(QUALITY_KEY, choice)
}

export function readTycoonSave(): TycoonSave {
  return readJson<TycoonSave>(TYCOON_KEY, { purse: 0, day: 1, decorations: [] })
}

export function writeTycoonSave(save: TycoonSave) {
  writeJson(TYCOON_KEY, save)
}

// Chapter IDs are stable save identifiers; unknown or damaged saves start safely.
export interface JourneySave {
  current: string
  completed: string[]
}
const JOURNEY_KEY = 'lammy-journey-v1'
export function readJourney(): JourneySave {
  const value = readJson<unknown>(JOURNEY_KEY, null)
  if (!value || typeof value !== 'object')
    return { current: FIRST_CHAPTER, completed: [] }
  const saved = value as Partial<JourneySave>
  const completed = CHAPTERS.filter(
    (c) => Array.isArray(saved.completed) && saved.completed.includes(c.id),
  ).map((c) => c.id)
  const current =
    CHAPTERS.find(
      (c) =>
        c.id === saved.current &&
        (c.id === FIRST_CHAPTER ||
          completed.includes(CHAPTERS[CHAPTERS.indexOf(c) - 1]?.id)),
    )?.id ?? FIRST_CHAPTER
  return { current, completed }
}
export function completeChapter(save: JourneySave, id: string): JourneySave {
  if (!CHAPTERS.some((c) => c.id === id)) return save
  const completed = CHAPTERS.filter(
    (c) => c.id === id || save.completed.includes(c.id),
  ).map((c) => c.id)
  const result = { current: nextChapter(id)?.id ?? id, completed }
  writeJson(JOURNEY_KEY, result)
  return result
}

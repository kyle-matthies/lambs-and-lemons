import type { GameState, Objective, ObjectiveProgress } from './types'

/**
 * What a chapter asks of you.
 *
 * Every objective is derived from state the simulation already keeps — stats,
 * bloom coverage, how many creatures are still lost — so nothing here needs its
 * own bookkeeping and the whole campaign stays playable headlessly.
 *
 * The shape of the readout matters as much as the rule: an icon, a number you
 * have, and a number you need. A child who cannot read a word of it can still
 * see 2/5 become 3/5 and know they are getting somewhere.
 */

function measure(objective: Objective, state: GameState): ObjectiveProgress {
  const stats = state.stats

  switch (objective.kind) {
    case 'freeAll':
      return progress('💛', 'Find everyone', stats.crittersFreed, state.critters.length)
    case 'freeCount':
      return progress('💛', 'Give out lemonade', stats.crittersFreed, objective.count)
    case 'bloom':
      // Shown as whole percents so the number ticks visibly rather than crawling.
      return progress(
        '🌈',
        'Bring back the colour',
        Math.round(state.bloomCoverage * 100),
        Math.round(objective.target * 100),
        '%',
      )
    case 'smash':
      return progress('🍋', 'Smash lemons', stats.lemonsSmashed, objective.count)
    case 'brew':
      return progress('🥤', 'Make lemonade', stats.cupsBrewed, objective.count)
    case 'breakTrees':
      return progress('🌳', 'Shake down the trees', stats.treesBroken, objective.count)
  }
}

function progress(
  icon: string,
  label: string,
  have: number,
  need: number,
  suffix = '',
): ObjectiveProgress {
  const capped = Math.min(have, need)
  return { icon, label, have: capped, need, suffix, done: have >= need }
}

/** Per-objective readout, in the order the chapter declares them. */
export function evaluateObjectives(state: GameState): ObjectiveProgress[] {
  return state.objectives.map((objective) => measure(objective, state))
}

export function objectivesComplete(state: GameState) {
  if (state.objectives.length === 0) return false
  return state.objectives.every((objective) => measure(objective, state).done)
}

/**
 * How far through the chapter you are, 0-1, averaged across objectives.
 *
 * This is what drives the light in story mode: with no clock to run down, the
 * sun has to be moved by the work instead. Every chapter therefore ends at
 * golden hour, because finishing *is* what makes the sun set.
 */
export function objectiveFraction(state: GameState) {
  if (state.objectives.length === 0) return 0
  let total = 0
  for (const objective of state.objectives) {
    const { have, need } = measure(objective, state)
    total += need > 0 ? Math.min(1, have / need) : 1
  }
  return total / state.objectives.length
}

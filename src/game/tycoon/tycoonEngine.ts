import type { DecorationId } from '../../lib/storage'

export type Coin = 1 | 5 | 10
export type TycoonPhase =
  | 'arriving'
  | 'ordering'
  | 'serving'
  | 'paying'
  | 'change'
  | 'happy'
  | 'daySummary'
  | 'shop'

export interface Customer {
  hue: number
  cups: number
  price: number
  payment: Coin[]
}

export type TycoonEvent =
  | { type: 'arrive' }
  | { type: 'serve' }
  | { type: 'coinCollect' }
  | { type: 'coinGiven' }
  | { type: 'coinBack' }
  | { type: 'wrongChange' }
  | { type: 'cheer'; tip: number }
  | { type: 'dayDone' }
  | { type: 'buy' }
  | { type: 'nextDay' }

export interface TycoonState {
  day: number
  customerNumber: number
  phase: TycoonPhase
  customer: Customer
  cupsServed: number
  paidCollected: number
  changeDue: number
  changeGiven: Coin[]
  hintTimer: number
  hintCoin: Coin | null
  walkT: number
  happyT: number
  orderT: number
  purse: number
  earnedToday: number
  cupsToday: number
  decorations: DecorationId[]
  events: TycoonEvent[]
}

export const CUSTOMERS_PER_DAY = 8
export const PRICE_PER_CUP = 3
export const TIP = 1
export const HINT_DELAY = 5
export const COIN_VALUES: Coin[] = [1, 5, 10]

export interface Decoration {
  id: DecorationId
  emoji: string
  name: string
  cost: number
}

export const DECORATIONS: Decoration[] = [
  { id: 'flowers', emoji: '🌼', name: 'Flowers', cost: 8 },
  { id: 'bunting', emoji: '🎏', name: 'Flags', cost: 10 },
  { id: 'umbrella', emoji: '⛱️', name: 'Umbrella', cost: 15 },
  { id: 'sign', emoji: '🪧', name: 'Big Sign', cost: 20 },
]

type Rng = () => number

export function generateOrder(day: number, rng: Rng): Customer {
  const hue = Math.floor(rng() * 360)
  const cups = day >= 3 && rng() < 0.4 ? 2 : 1
  const price = cups * PRICE_PER_CUP

  let payment: Coin[]
  if (day <= 1) {
    // Day 1: exact coins — pure counting practice.
    payment = Array.from({ length: price }, () => 1 as Coin)
  } else if (day === 2) {
    payment = [5]
  } else if (day === 3) {
    payment = price > 5 ? [10] : rng() < 0.5 ? [5] : [10]
  } else {
    const options: Coin[][] = price > 5 ? [[10], [5, 5], [10, 1]] : [[5], [10], [5, 1]]
    payment = options[Math.floor(rng() * options.length)]
  }

  return { hue, cups, price, payment }
}

export function createTycoon(
  purse: number,
  day: number,
  decorations: DecorationId[],
  rng: Rng = Math.random,
): TycoonState {
  return {
    day,
    customerNumber: 1,
    phase: 'arriving',
    customer: generateOrder(day, rng),
    cupsServed: 0,
    paidCollected: 0,
    changeDue: 0,
    changeGiven: [],
    hintTimer: 0,
    hintCoin: null,
    walkT: 0,
    happyT: 0,
    orderT: 0,
    purse,
    earnedToday: 0,
    cupsToday: 0,
    decorations: [...decorations],
    events: [],
  }
}

export function tickTycoon(state: TycoonState, dt: number, rng: Rng = Math.random) {
  switch (state.phase) {
    case 'arriving':
      state.walkT = Math.min(1, state.walkT + dt / 1.1)
      if (state.walkT >= 1) {
        state.phase = 'ordering'
        state.orderT = 0
        state.events.push({ type: 'arrive' })
      }
      break
    case 'ordering':
      state.orderT += dt
      if (state.orderT >= 0.9) state.phase = 'serving'
      break
    case 'change':
      state.hintTimer += dt
      if (state.hintTimer >= HINT_DELAY) {
        state.hintCoin = nextHintCoin(state)
      }
      break
    case 'happy':
      state.happyT += dt
      if (state.happyT >= 1.4) {
        if (state.customerNumber >= CUSTOMERS_PER_DAY) {
          state.phase = 'daySummary'
          state.events.push({ type: 'dayDone' })
        } else {
          state.customerNumber += 1
          state.customer = generateOrder(state.day, rng)
          state.phase = 'arriving'
          state.walkT = 0
          state.cupsServed = 0
          state.paidCollected = 0
          state.changeDue = 0
          state.changeGiven = []
          state.hintTimer = 0
          state.hintCoin = null
          state.happyT = 0
        }
      }
      break
    default:
      break
  }
}

export function serveCup(state: TycoonState) {
  if (state.phase !== 'serving' || state.cupsServed >= state.customer.cups) return
  state.cupsServed += 1
  state.cupsToday += 1
  state.events.push({ type: 'serve' })
  if (state.cupsServed >= state.customer.cups) {
    state.phase = 'paying'
  }
}

export function collectPaymentCoin(state: TycoonState) {
  if (state.phase !== 'paying' || state.paidCollected >= state.customer.payment.length) return
  state.paidCollected += 1
  state.events.push({ type: 'coinCollect' })
  if (state.paidCollected >= state.customer.payment.length) {
    const paid = state.customer.payment.reduce<number>((sum, coin) => sum + coin, 0)
    state.changeDue = paid - state.customer.price
    if (state.changeDue > 0) {
      state.phase = 'change'
      state.hintTimer = 0
      state.hintCoin = null
    } else {
      completeSale(state)
    }
  }
}

export function giveCoin(state: TycoonState, coin: Coin) {
  if (state.phase !== 'change') return
  const given = changeGivenTotal(state)
  if (given + coin > state.changeDue) {
    // Too much — bounce the coin back instead of ever taking money from the kid.
    state.events.push({ type: 'wrongChange' })
    state.hintTimer = Math.max(state.hintTimer, HINT_DELAY - 1.5)
    return
  }
  state.changeGiven.push(coin)
  state.hintTimer = 0
  state.hintCoin = null
  state.events.push({ type: 'coinGiven' })
}

export function takeBackCoin(state: TycoonState, index: number) {
  if (state.phase !== 'change' || index < 0 || index >= state.changeGiven.length) return
  state.changeGiven.splice(index, 1)
  state.events.push({ type: 'coinBack' })
}

export function confirmChange(state: TycoonState) {
  if (state.phase !== 'change') return
  if (changeGivenTotal(state) === state.changeDue) {
    completeSale(state)
  } else {
    state.events.push({ type: 'wrongChange' })
    state.hintTimer = Math.max(state.hintTimer, HINT_DELAY - 1.5)
  }
}

export function buyDecoration(state: TycoonState, id: DecorationId) {
  if (state.phase !== 'shop') return
  const item = DECORATIONS.find((decoration) => decoration.id === id)
  if (!item || state.decorations.includes(id) || state.purse < item.cost) return
  state.purse -= item.cost
  state.decorations.push(id)
  state.events.push({ type: 'buy' })
}

export function openShop(state: TycoonState) {
  if (state.phase === 'daySummary') state.phase = 'shop'
}

export function closeShop(state: TycoonState) {
  if (state.phase === 'shop') state.phase = 'daySummary'
}

export function startNextDay(state: TycoonState, rng: Rng = Math.random) {
  if (state.phase !== 'daySummary' && state.phase !== 'shop') return
  state.day += 1
  state.customerNumber = 1
  state.customer = generateOrder(state.day, rng)
  state.phase = 'arriving'
  state.walkT = 0
  state.cupsServed = 0
  state.paidCollected = 0
  state.changeDue = 0
  state.changeGiven = []
  state.hintTimer = 0
  state.hintCoin = null
  state.happyT = 0
  state.earnedToday = 0
  state.cupsToday = 0
  state.events.push({ type: 'nextDay' })
}

export function changeGivenTotal(state: TycoonState) {
  return state.changeGiven.reduce<number>((sum, coin) => sum + coin, 0)
}

function nextHintCoin(state: TycoonState): Coin {
  const remaining = state.changeDue - changeGivenTotal(state)
  if (remaining >= 10) return 10
  if (remaining >= 5) return 5
  return 1
}

function completeSale(state: TycoonState) {
  const earned = state.customer.price + TIP
  state.purse += earned
  state.earnedToday += earned
  state.phase = 'happy'
  state.happyT = 0
  state.events.push({ type: 'cheer', tip: TIP })
}

export function drainTycoonEvents(state: TycoonState) {
  if (state.events.length === 0) return []
  const events = state.events
  state.events = []
  return events
}

import { useEffect, useRef, useState } from 'react'
import { StandScene } from '../../render/StandScene'
import type { SoundManager } from '../../audio/sound'
import type { DecorationId, TycoonSave } from '../../lib/storage'
import {
  buyDecoration,
  closeShop,
  collectPaymentCoin,
  confirmChange,
  changeGivenTotal,
  createTycoon,
  CUSTOMERS_PER_DAY,
  DECORATIONS,
  drainTycoonEvents,
  giveCoin,
  openShop,
  serveCup,
  startNextDay,
  takeBackCoin,
  tickTycoon,
  type Coin,
  type TycoonEvent,
  type TycoonState,
} from './tycoonEngine'

const COIN_BUTTONS: Coin[] = [1, 5, 10]

const EVENT_SOUNDS: Record<TycoonEvent['type'], Parameters<SoundManager['play']>[0] | null> = {
  arrive: 'tap',
  serve: 'pop',
  coinCollect: 'coin',
  coinGiven: 'coin',
  coinBack: 'tap',
  wrongChange: 'uhOh',
  cheer: 'cheer',
  dayDone: 'fanfare',
  buy: 'sparkle',
  nextDay: 'tap',
}

interface TycoonSnapshot {
  phase: TycoonState['phase']
  day: number
  customerNumber: number
  cups: number
  cupsServed: number
  price: number
  paymentCount: number
  paidCollected: number
  paymentCoins: Coin[]
  changeDue: number
  changeGiven: Coin[]
  changeTotal: number
  hintCoin: Coin | null
  purse: number
  earnedToday: number
  cupsToday: number
  decorations: DecorationId[]
}

function snapshotOf(state: TycoonState): TycoonSnapshot {
  return {
    phase: state.phase,
    day: state.day,
    customerNumber: state.customerNumber,
    cups: state.customer.cups,
    cupsServed: state.cupsServed,
    price: state.customer.price,
    paymentCount: state.customer.payment.length,
    paidCollected: state.paidCollected,
    paymentCoins: [...state.customer.payment],
    changeDue: state.changeDue,
    changeGiven: [...state.changeGiven],
    changeTotal: changeGivenTotal(state),
    hintCoin: state.hintCoin,
    purse: state.purse,
    earnedToday: state.earnedToday,
    cupsToday: state.cupsToday,
    decorations: [...state.decorations],
  }
}

export function TycoonScreen({
  sound,
  muted,
  onToggleMute,
  onExit,
  save,
  onSave,
}: {
  sound: SoundManager
  muted: boolean
  onToggleMute: () => void
  onExit: () => void
  save: TycoonSave
  onSave: (save: TycoonSave) => void
}) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<StandScene | null>(null)
  const stateRef = useRef<TycoonState>(createTycoon(save.purse, save.day, save.decorations))
  const soundRef = useRef(sound)
  const onSaveRef = useRef(onSave)
  soundRef.current = sound
  onSaveRef.current = onSave

  const [sceneReady, setSceneReady] = useState(false)
  const [snap, setSnap] = useState<TycoonSnapshot>(() => snapshotOf(stateRef.current))

  // Build the 3D stand a frame late so the coin UI paints first.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const handle = requestAnimationFrame(() => {
      if (cancelled) return
      try {
        sceneRef.current = new StandScene(canvas)
        sceneRef.current.setDecorations(stateRef.current.decorations)
      } catch (error) {
        console.error('Unable to start the stand scene', error)
        return
      }
      setSceneReady(true)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(handle)
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !sceneReady) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      sceneRef.current?.setSize(rect.width, rect.height)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let frame = 0
    let lastTime = performance.now()
    let lastUiTime = 0

    const tick = (now: number) => {
      const state = stateRef.current
      const scene = sceneRef.current
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      tickTycoon(state, dt)

      const events = drainTycoonEvents(state)
      events.forEach((event) => {
        const sfx = EVENT_SOUNDS[event.type]
        if (sfx) soundRef.current.play(sfx)
        if (event.type === 'cheer') scene?.cheer()
        if (event.type === 'buy') scene?.setDecorations(state.decorations)
        if (
          event.type === 'cheer' ||
          event.type === 'buy' ||
          event.type === 'dayDone' ||
          event.type === 'nextDay'
        ) {
          onSaveRef.current({
            purse: state.purse,
            day: state.day,
            decorations: [...state.decorations],
          })
        }
      })

      scene?.frame(
        {
          phase: state.phase,
          walkT: state.walkT,
          customerIndex: state.customerNumber,
          hue: (state.customer.hue % 360) / 360,
        },
        dt,
      )

      if (now - lastUiTime > 80) {
        setSnap(snapshotOf(state))
        lastUiTime = now
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [sceneReady])

  const act = (action: (state: TycoonState) => void) => {
    action(stateRef.current)
    setSnap(snapshotOf(stateRef.current))
  }

  const changeRemaining = snap.changeDue - snap.changeTotal

  return (
    <main className="game-shell">
      <section className="phone-stage tycoon-stage" ref={stageRef} aria-label="My Lemonade Stand">
        <header className="tycoon-header">
          <button className="round-icon-button" type="button" onClick={onExit} aria-label="Home">
            🏠
          </button>
          <div className="tycoon-day">
            Day {snap.day} · 🐑 {Math.min(snap.customerNumber, CUSTOMERS_PER_DAY)}/{CUSTOMERS_PER_DAY}
          </div>
          <div className="tycoon-purse">🪙 {snap.purse}</div>
          <button
            className="round-icon-button"
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </header>

        <canvas className="tycoon-canvas" ref={canvasRef} aria-hidden="true" />

        {!sceneReady && <div className="loading-panel">Opening the stand…</div>}

        <div className="tycoon-controls">
          {snap.phase === 'arriving' && <p className="tycoon-caption">Here comes a customer…</p>}
          {snap.phase === 'ordering' && (
            <p className="tycoon-caption">
              I want {snap.cups} 🥤 please! That is {snap.price} 🪙
            </p>
          )}

          {snap.phase === 'serving' && (
            <div className="tycoon-panel">
              <p className="tycoon-caption">Give {snap.cups - snap.cupsServed} more 🥤</p>
              <button className="serve-button" type="button" onClick={() => act(serveCup)}>
                🥤 Serve!
              </button>
            </div>
          )}

          {snap.phase === 'paying' && (
            <div className="tycoon-panel">
              <p className="tycoon-caption">Take the coins! Tap each one</p>
              <div className="pay-coins">
                {snap.paymentCoins.map((coin, index) => (
                  <button
                    key={index}
                    className={`coin coin-${coin} ${index < snap.paidCollected ? 'collected' : ''}`}
                    type="button"
                    disabled={index < snap.paidCollected}
                    onClick={() => act(collectPaymentCoin)}
                  >
                    {coin}
                  </button>
                ))}
              </div>
            </div>
          )}

          {snap.phase === 'change' && (
            <div className="tycoon-panel">
              <p className="tycoon-caption">
                Give back {changeRemaining > 0 ? changeRemaining : snap.changeDue} 🪙
              </p>
              <div className="change-dots" aria-hidden="true">
                {Array.from({ length: snap.changeDue }, (_, index) => (
                  <span key={index} className={index < snap.changeTotal ? 'dot filled' : 'dot'} />
                ))}
              </div>
              <div className="coin-tray">
                {COIN_BUTTONS.map((coin) => (
                  <button
                    key={coin}
                    className={`coin coin-${coin} ${snap.hintCoin === coin ? 'hint' : ''}`}
                    type="button"
                    onClick={() => act((state) => giveCoin(state, coin))}
                  >
                    {coin}
                  </button>
                ))}
              </div>
              {snap.changeGiven.length > 0 && (
                <div className="given-row">
                  {snap.changeGiven.map((coin, index) => (
                    <button
                      key={index}
                      className={`coin coin-${coin} small`}
                      type="button"
                      onClick={() => act((state) => takeBackCoin(state, index))}
                      aria-label={`Take back ${coin} coin`}
                    >
                      {coin}
                    </button>
                  ))}
                </div>
              )}
              <button className="confirm-button" type="button" onClick={() => act(confirmChange)}>
                ✅ Here you go!
              </button>
            </div>
          )}

          {snap.phase === 'happy' && <p className="tycoon-caption big">😊 Thank you! +🪙</p>}
        </div>

        {snap.phase === 'daySummary' && (
          <div className="game-overlay">
            <div className="end-panel">
              <h2>Day {snap.day} done!</h2>
              <div className="stat-rows">
                <div className="stat-row">
                  <span className="stat-icon">🥤</span>
                  <span className="stat-label">Cups served</span>
                  <strong>{snap.cupsToday}</strong>
                </div>
                <div className="stat-row">
                  <span className="stat-icon">🪙</span>
                  <span className="stat-label">Coins earned</span>
                  <strong>{snap.earnedToday}</strong>
                </div>
              </div>
              <button className="start-button" type="button" onClick={() => act(openShop)}>
                🛍️ Shop
              </button>
              <button className="start-button next-day" type="button" onClick={() => act((state) => startNextDay(state))}>
                Next day
              </button>
              <button className="quiet-button" type="button" onClick={onExit}>
                Home
              </button>
            </div>
          </div>
        )}

        {snap.phase === 'shop' && (
          <div className="game-overlay">
            <div className="end-panel shop-panel">
              <h2>Stand shop</h2>
              <p className="shop-purse">You have 🪙 {snap.purse}</p>
              <div className="shop-grid">
                {DECORATIONS.map((item) => {
                  const owned = snap.decorations.includes(item.id)
                  return (
                    <button
                      key={item.id}
                      className={`shop-item ${owned ? 'owned' : ''}`}
                      type="button"
                      disabled={owned || snap.purse < item.cost}
                      onClick={() => act((state) => buyDecoration(state, item.id))}
                    >
                      <span className="shop-emoji">{item.emoji}</span>
                      <strong>{item.name}</strong>
                      <span>{owned ? 'Yours!' : `🪙 ${item.cost}`}</span>
                    </button>
                  )
                })}
              </div>
              <button className="start-button" type="button" onClick={() => act(closeShop)}>
                Back
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}

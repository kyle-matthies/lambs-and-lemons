import { useEffect, useRef, useState } from 'react'
import { loadGameAssets, type GameAssets } from '../assets'
import { drawDecorations } from '../render'
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
  const assetsRef = useRef<GameAssets | null>(null)
  const stateRef = useRef<TycoonState>(createTycoon(save.purse, save.day, save.decorations))
  const soundRef = useRef(sound)
  const onSaveRef = useRef(onSave)
  soundRef.current = sound
  onSaveRef.current = onSave

  const [assetsReady, setAssetsReady] = useState(false)
  const [snap, setSnap] = useState<TycoonSnapshot>(() => snapshotOf(stateRef.current))

  useEffect(() => {
    let mounted = true
    loadGameAssets().then((assets) => {
      if (!mounted) return
      assetsRef.current = assets
      setAssetsReady(true)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage || !assetsReady) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const context = canvas.getContext('2d')
      context?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    let frame = 0
    let lastTime = performance.now()
    let lastUiTime = 0
    let happyClock = 0

    const tick = (now: number) => {
      const state = stateRef.current
      const assets = assetsRef.current
      const context = canvas.getContext('2d')
      const dt = Math.min(0.05, (now - lastTime) / 1000)
      lastTime = now

      tickTycoon(state, dt)
      happyClock = state.phase === 'happy' ? happyClock + dt : 0

      const events = drainTycoonEvents(state)
      events.forEach((event) => {
        const sfx = EVENT_SOUNDS[event.type]
        if (sfx) soundRef.current.play(sfx)
        if (event.type === 'cheer' || event.type === 'buy' || event.type === 'dayDone') {
          onSaveRef.current({
            purse: state.purse,
            day: state.day,
            decorations: [...state.decorations],
          })
        }
      })

      if (assets && context) {
        drawScene(context, canvas, assets, state, happyClock)
      }

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
  }, [assetsReady])

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

        {!assetsReady && <div className="loading-panel">Loading</div>}

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

function drawScene(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  assets: GameAssets,
  state: TycoonState,
  happyClock: number,
) {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width === 0 || height === 0) return
  const scale = Math.max(0.9, Math.min(width / 390, 1.4))

  context.clearRect(0, 0, width, height)
  context.drawImage(assets.background, 0, -height * 0.4, width, height * 2)
  drawImageCentered(context, assets.sun, width * 0.1, height * 0.14, 66 * scale)

  const standX = width * 0.28
  const standY = height * 0.62
  // Lammy peeks out beside the right post of her stand.
  drawSprite(context, assets.lambIdle, standX + 82 * scale, standY - 34 * scale, 66 * scale, 70 * scale, false)
  drawSprite(context, assets.stand, standX, standY, 180 * scale, 168 * scale, false)
  drawDecorations(context, standX, standY, 1.35 * scale, state.decorations)

  // Customer walks in from the right.
  if (state.phase !== 'daySummary' && state.phase !== 'shop') {
    const targetX = width * 0.7
    const startX = width + 70
    const eased = 1 - Math.pow(1 - state.walkT, 3)
    const customerX = startX + (targetX - startX) * eased
    const customerY = standY + 18 * scale
    const bob = state.phase === 'arriving' ? Math.abs(Math.sin(state.walkT * 14)) * 6 : 0

    const supportsFilter = typeof context.filter === 'string'
    context.save()
    if (supportsFilter) context.filter = `hue-rotate(${state.customer.hue}deg) saturate(1.15)`
    drawSprite(context, assets.lambIdle, customerX, customerY - bob, 86 * scale, 92 * scale, true)
    context.restore()

    if (state.phase === 'ordering' || state.phase === 'serving' || state.phase === 'paying') {
      drawBubble(context, customerX, customerY - 92 * scale, scale, state)
    }

    if (state.phase === 'happy') {
      for (let index = 0; index < 5; index += 1) {
        const t = (happyClock * 1.4 + index * 0.23) % 1
        const x = customerX - 20 * scale + Math.sin((t + index) * 9) * 18 * scale + index * 9 * scale
        const y = customerY - 60 * scale - t * 90 * scale
        context.save()
        context.globalAlpha = 1 - t
        context.font = `${Math.round(18 * scale)}px sans-serif`
        context.textAlign = 'center'
        context.fillText('💛', x, y)
        context.restore()
      }
    }

    // Served cups slide across the counter.
    for (let index = 0; index < state.cupsServed; index += 1) {
      const cupX = standX + 70 * scale + index * 26 * scale
      context.font = `${Math.round(24 * scale)}px sans-serif`
      context.textAlign = 'center'
      context.fillText('🥤', cupX, standY - 26 * scale)
    }
  }
}

function drawBubble(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  state: TycoonState,
) {
  const bubbleWidth = 128 * scale
  const bubbleHeight = 66 * scale
  const left = x - bubbleWidth * 0.72

  context.save()
  context.fillStyle = 'rgba(255, 255, 255, 0.95)'
  context.strokeStyle = 'rgba(99, 74, 29, 0.35)'
  context.lineWidth = 2.5 * scale
  context.beginPath()
  context.roundRect(left, y - bubbleHeight / 2, bubbleWidth, bubbleHeight, 14 * scale)
  context.fill()
  context.stroke()
  context.beginPath()
  context.moveTo(x - 6 * scale, y + bubbleHeight / 2)
  context.lineTo(x + 10 * scale, y + bubbleHeight / 2 + 14 * scale)
  context.lineTo(x + 16 * scale, y + bubbleHeight / 2 - 2 * scale)
  context.closePath()
  context.fill()

  context.fillStyle = '#472b16'
  context.font = `900 ${Math.round(17 * scale)}px Nunito, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(
    `🥤×${state.customer.cups}`,
    left + bubbleWidth / 2,
    y - bubbleHeight / 2 + 18 * scale,
  )

  // The price drawn as countable coin dots.
  const dots = state.customer.price
  const dotRadius = 5.5 * scale
  const gap = 3.5 * scale
  const rowWidth = dots * (dotRadius * 2 + gap) - gap
  let dotX = left + bubbleWidth / 2 - rowWidth / 2 + dotRadius
  const dotY = y + bubbleHeight / 2 - 16 * scale
  for (let index = 0; index < dots; index += 1) {
    context.beginPath()
    context.fillStyle = '#ffca28'
    context.strokeStyle = '#b8860b'
    context.lineWidth = 1.6 * scale
    context.arc(dotX, dotY, dotRadius, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    dotX += dotRadius * 2 + gap
  }
  context.restore()
}

function drawImageCentered(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
) {
  context.drawImage(image, x - size / 2, y - size / 2, size, size)
}

function drawSprite(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  flip: boolean,
) {
  context.save()
  if (flip) {
    context.translate(x, y)
    context.scale(-1, 1)
    context.drawImage(image, -width / 2, -height / 2, width, height)
  } else {
    context.drawImage(image, x - width / 2, y - height / 2, width, height)
  }
  context.restore()
}

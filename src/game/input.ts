import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { GameInput } from './types'

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}

/**
 * Desktop controls: WASD/arrows write the same normalized vector the joystick
 * uses; Space smashes. The joystick wins whenever a pointer is captured on it.
 */
export function useKeyboardInput(
  inputRef: MutableRefObject<GameInput>,
  joystickActiveRef: MutableRefObject<boolean>,
  onSmash: () => void,
) {
  useEffect(() => {
    const pressed = new Set<string>()

    const applyMovement = () => {
      if (joystickActiveRef.current) return
      let x = 0
      let y = 0
      pressed.forEach((code) => {
        const move = MOVE_KEYS[code]
        if (move) {
          x += move[0]
          y += move[1]
        }
      })
      const length = Math.hypot(x, y)
      if (length > 0) {
        inputRef.current = { active: true, x: x / length, y: y / length }
      } else {
        inputRef.current = { active: false, x: 0, y: 0 }
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        if (!event.repeat) onSmash()
        event.preventDefault()
        return
      }
      if (MOVE_KEYS[event.code]) {
        pressed.add(event.code)
        applyMovement()
        event.preventDefault()
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (pressed.delete(event.code)) applyMovement()
    }

    const onBlur = () => {
      pressed.clear()
      applyMovement()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [inputRef, joystickActiveRef, onSmash])
}

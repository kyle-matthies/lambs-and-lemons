import { createHash } from 'node:crypto'
import { createWorld, generateGroveLayout } from '../src/game/world.ts'
import { spawnCritters } from '../src/game/critters.ts'
import { TREE_COUNT } from '../src/game/constants.ts'

/**
 * A fingerprint of the arcade valley.
 *
 * The campaign refactor turned every hardcoded constant in `world.ts` into a
 * recipe field, and the one thing that must not change while doing so is the
 * place arcade mode has always generated. The autoplay bot can't prove that —
 * it's stochastic — so this hashes the terrain, the scatter and the critter
 * spawns directly. Run it on both revisions and diff.
 */

const SEED = 20260802
const world = createWorld(SEED)
const layout = generateGroveLayout(world, TREE_COUNT)
const critters = spawnCritters(world, SEED)

const round = (value) => Math.round(value * 1e6) / 1e6
const points = (list) => list.map((p) => [p.x, p.y, p.z, p.rotation, p.scale, p.variant].map(round))

// Terrain is a closure, so sample it on a fixed grid rather than trying to read it.
const heights = []
for (let x = -40; x <= 40; x += 2.5) {
  for (let z = -40; z <= 40; z += 2.5) heights.push(round(world.heightAt(x, z)))
}

const fingerprint = {
  playRadius: world.playRadius,
  pond: world.pond,
  waterLevel: round(world.waterLevel),
  flats: world.flats,
  heights,
  stand: [layout.stand.x, layout.stand.y, layout.stand.z, layout.standRotation].map(round),
  counts: {
    trees: layout.trees.length,
    rocks: layout.rocks.length,
    bushes: layout.bushes.length,
    flowers: layout.flowers.length,
    reeds: layout.reeds.length,
  },
  trees: points(layout.trees),
  rocks: points(layout.rocks),
  bushes: points(layout.bushes),
  flowers: points(layout.flowers),
  reeds: points(layout.reeds),
  critters: critters.map((c) => [c.kind, round(c.homeX), round(c.homeZ), round(c.hue)]),
}

const json = JSON.stringify(fingerprint)
console.log('counts   ', JSON.stringify(fingerprint.counts))
console.log('stand    ', JSON.stringify(fingerprint.stand))
console.log('waterLvl ', fingerprint.waterLevel)
console.log('sha256   ', createHash('sha256').update(json).digest('hex'))

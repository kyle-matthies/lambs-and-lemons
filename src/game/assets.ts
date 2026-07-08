export const assetPaths = {
  background: '/assets/field-background.png',
  lambIdle: '/assets/lamb-idle.png',
  lambSwing: '/assets/lamb-swing.png',
  lemon: '/assets/lemon.png',
  leaf: '/assets/leaf.png',
  splat: '/assets/splat.png',
  tree: '/assets/tree.png',
  stump: '/assets/stump.png',
  stand: '/assets/stand.png',
  crate: '/assets/crate.png',
  smashButton: '/assets/smash-button.png',
  sun: '/assets/sun.png',
} as const

export type AssetKey = keyof typeof assetPaths
export type GameAssets = Record<AssetKey, HTMLImageElement>

export function loadGameAssets(): Promise<GameAssets> {
  const entries = Object.entries(assetPaths) as [AssetKey, string][]

  return Promise.all(
    entries.map(
      ([key, path]) =>
        new Promise<[AssetKey, HTMLImageElement]>((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve([key, image])
          image.onerror = () => reject(new Error(`Unable to load ${path}`))
          image.src = path
        }),
    ),
  ).then((loaded) => Object.fromEntries(loaded) as GameAssets)
}

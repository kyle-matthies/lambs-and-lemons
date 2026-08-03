/**
 * Resolver hook so Node can run the game's pure modules directly.
 *
 * The source uses extensionless relative imports (bundler resolution), which
 * Node's native TypeScript stripping doesn't accept. This retries any
 * extensionless relative specifier with `.ts` appended.
 */
export function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return next(`${specifier}.ts`, context)
    } catch {
      // Fall through so Node reports the original resolution failure.
    }
  }
  return next(specifier, context)
}

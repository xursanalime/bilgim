/**
 * `shaka-player` is an OPTIONAL dependency of protected-video-player.tsx —
 * it is not installed in apps/web (see loadShaka()'s `webpackIgnore`
 * dynamic import). This ambient shim only exists so `tsc` can resolve the
 * bare specifier; the actual runtime shape is validated defensively at the
 * call site (`ShakaModule` in protected-video-player.tsx), not here.
 */
declare module 'shaka-player' {
  const shaka: unknown;
  export default shaka;
}

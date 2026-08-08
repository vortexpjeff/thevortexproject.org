export function resolveBuildMode(value = process.env.VORTEX_BUILD_MODE) {
  const mode = value || 'preview';
  if (mode !== 'preview' && mode !== 'production') {
    throw new Error('VORTEX_BUILD_MODE must be preview or production');
  }
  return mode;
}

export function createBuildContext(value = process.env.VORTEX_BUILD_MODE) {
  const mode = resolveBuildMode(value);
  return {
    mode,
    preview: mode === 'preview',
    production: mode === 'production',
    robots: mode === 'preview' ? 'noindex,nofollow' : 'index,follow',
  };
}

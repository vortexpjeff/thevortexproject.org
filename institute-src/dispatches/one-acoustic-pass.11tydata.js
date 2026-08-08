export default {
  permalink: process.env.VORTEX_BUILD_MODE === 'production'
    ? false
    : 'dispatches/one-acoustic-pass/index.html',
};

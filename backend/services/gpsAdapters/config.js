// Keeping vendor timing config here (not scattered across the code) makes
// onboarding a new vendor fast: one adapter file + one entry here.
// 'generic_rest' is the real production adapter — an admin configures a
// specific vendor's REST endpoint + field paths against it from the
// Transport settings panel; 'generic_poll' stays as a no-credentials demo
// simulator for trying out the map/pipeline before a real vendor is wired.
export default {
  generic_poll: { type: 'pull', intervalSeconds: 30 },
  generic_rest: { type: 'pull', intervalSeconds: 60 },
  traxroot: { type: 'push' },
};

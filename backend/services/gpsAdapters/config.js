// Keeping vendor timing config here (not scattered across the code) makes
// onboarding a new vendor fast: one adapter file + one entry here.
export default {
  generic_poll: { type: 'pull', intervalSeconds: 30 },
  trackmybus: { type: 'pull', intervalSeconds: 60 },
  traxroot: { type: 'push' },
};

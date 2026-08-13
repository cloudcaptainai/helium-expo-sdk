/**
 * These suites cover the TypeScript bridge layer, which reaches React Native and the native
 * modules only through mocks, so they run in plain Node without the React Native runtime.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  clearMocks: true,
  // Spied globals such as `console` are shared across suites, unlike the module-isolated mocks.
  restoreMocks: true,
};

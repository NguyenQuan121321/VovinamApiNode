import type { Config } from 'jest';

const coverageFloor = { statements: 75, branches: 75, functions: 75, lines: 75 };

const config: Config = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // Wiring files (main/bootstrap/app.module) are exercised by the e2e job, not unit tests.
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/bootstrap.ts', '!src/app.module.ts'],
  coverageDirectory: '<rootDir>/coverage',
  coverageThreshold: {
    global: coverageFloor,
    // Coverage floor 75% (plan section 12) is enforced per package from the moment the
    // package exists; in P0 these are stubs so the floor is already binding before P1.
    './src/auth/': coverageFloor,
    './src/billing/': coverageFloor,
    './src/classes/': coverageFloor,
  },
  testEnvironment: 'node',
  clearMocks: true,
  setupFiles: ['<rootDir>/test/jest-setup.ts'],
  passWithNoTests: true,
  reporters: ['default', '<rootDir>/test/annotation-reporter.js'],
};

export default config;

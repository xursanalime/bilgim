import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Playwright e2e specs (apps/web/e2e/**) use the @playwright/test runner,
  // not Jest — exclude them so `pnpm test` doesn't try (and fail) to load
  // `@playwright/test` under jsdom. Run e2e via `pnpm test:e2e` instead.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/e2e/'],
  moduleNameMapper: {
    // Workspace package aliases (mirrors tsconfig `paths`) so tests can
    // import the shared @bilgim/i18n package and its locale catalogs.
    '^@bilgim/i18n$': '<rootDir>/../../packages/i18n/src/index.ts',
    '^@bilgim/i18n/(.*)$': '<rootDir>/../../packages/i18n/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config);

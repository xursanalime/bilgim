import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // `otplib` ships CJS that requires `@scure/base`, which is ESM-only.
  // Tell Jest to transform those packages (default ignores everything in
  // node_modules) so the ESM `export` keyword can be parsed by ts-jest.
  transformIgnorePatterns: [
    'node_modules/\\.pnpm/(?!@scure\\+base|@noble\\+hashes)',
  ],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    // Some otplib internals reach for `@scure/base` directly via its
    // ESM entry; map back to the CJS-friendly path inside the pnpm
    // store so ts-jest never tries to parse the raw ESM file.
    '^@scure/base$':
      '<rootDir>/../../node_modules/.pnpm/@scure+base@2.2.0/node_modules/@scure/base/index.js',
  },
};

export default config;

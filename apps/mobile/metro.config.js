/**
 * Metro bundler config for the EduBridge mobile app inside a pnpm monorepo.
 *
 * pnpm hoists shared dependencies to the workspace root and uses symlinked
 * `node_modules` per package. Metro's default resolver only walks
 * `apps/mobile/node_modules`, so we explicitly:
 *
 *   1. Watch the entire workspace so changes in `packages/*` rebuild.
 *   2. Tell the resolver about both `apps/mobile/node_modules` and the
 *      workspace root `node_modules` so React + Expo native modules de-dup.
 *   3. Disable hierarchical lookup which is unnecessary in a workspace and
 *      can cause Metro to resolve duplicate copies of `react`.
 *
 * Reference: https://docs.expo.dev/guides/monorepos/
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the workspace root so changes in `packages/*` are picked up.
config.watchFolders = [workspaceRoot];

// 2. Force Metro to resolve modules from these two `node_modules` trees
//    only — pnpm symlinks ensure both point at the same physical files.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Disable hierarchical lookup; the explicit list above is authoritative.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;

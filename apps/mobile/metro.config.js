const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the workspace root so changes in `packages/*` are picked up.
config.watchFolders = [workspaceRoot];

// Expo 50+ natively supports symlinks (which pnpm uses)
// We only need to tell it to watch the workspace root.
// Node module resolution is handled automatically.

module.exports = config;

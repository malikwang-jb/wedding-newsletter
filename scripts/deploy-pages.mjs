#!/usr/bin/env node

/**
 * GitHub Pages deploy script.
 * Reads configuration from .deploy-pages.json in the project root.
 * Supports both "tagged" and "multi-live" versioning strategies.
 *
 * Usage: node scripts/deploy-pages.mjs
 */

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve('.');
const CONFIG_PATH = join(ROOT, '.deploy-pages.json');
const DEPLOY_DIR = join(ROOT, '_deploy');

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function gitLoud(args, opts = {}) {
  execFileSync('git', args, { encoding: 'utf8', stdio: 'inherit', ...opts });
}

function runLoud(cmd, opts = {}) {
  execSync(cmd, { encoding: 'utf8', stdio: 'inherit', ...opts });
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error('Error: .deploy-pages.json not found. Run the deploy skill first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

function readVersion() {
  const pkgPath = join(ROOT, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error('Error: package.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
}

function writeConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

function cleanDeployDir() {
  if (existsSync(DEPLOY_DIR)) {
    console.log('Cleaning stale _deploy directory...');
    rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
}

function tagExists(tag, cwd) {
  try {
    git(['rev-parse', `refs/tags/${tag}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

function cloneGhPages(remote) {
  try {
    git(['clone', '--branch', 'gh-pages', '--single-branch', remote, '_deploy'], { cwd: ROOT });
  } catch {
    console.log('gh-pages branch does not exist yet — creating it.');
    mkdirSync(DEPLOY_DIR, { recursive: true });
    gitLoud(['init'], { cwd: DEPLOY_DIR });
    gitLoud(['checkout', '-b', 'gh-pages'], { cwd: DEPLOY_DIR });
    gitLoud(['remote', 'add', 'origin', remote], { cwd: DEPLOY_DIR });
  }
}

const COPY_EXCLUDE = new Set([
  '.git', 'node_modules', '_deploy', '.deploy-pages.json',
  'package.json', 'package-lock.json', '.gitignore',
  '.DS_Store', '.env', '.env.local',
]);

function copyBuildOutput(buildOutDir, destDir) {
  const srcDir = join(ROOT, buildOutDir);
  if (!existsSync(srcDir)) {
    console.error(`Error: Build output directory "${buildOutDir}" not found. Did the build succeed?`);
    process.exit(1);
  }
  if (buildOutDir === '.') {
    // Static site: project root IS the output. Copy selectively.
    for (const entry of readdirSync(srcDir)) {
      if (COPY_EXCLUDE.has(entry)) continue;
      cpSync(join(srcDir, entry), join(destDir, entry), { recursive: true });
    }
  } else {
    cpSync(srcDir, destDir, { recursive: true });
  }
}

function main() {
  const config = readConfig();
  const { remote, basePath, buildTool, buildOutDir, versionStrategy } = config;
  const version = readVersion();

  console.log(`\nDeploying v${version} to GitHub Pages (strategy: ${versionStrategy})\n`);

  cleanDeployDir();

  // --- Build ---
  if (buildTool !== 'static') {
    const env = { ...process.env };
    if (versionStrategy === 'multi-live') {
      const deployBase = `${basePath}v${version}/`;
      switch (buildTool) {
        case 'vite':
          env.DEPLOY_BASE = deployBase;
          break;
        case 'cra':
          env.PUBLIC_URL = deployBase;
          break;
        case 'next':
          env.DEPLOY_BASE = deployBase.replace(/\/$/, '');
          break;
      }
    }
    console.log('Building...');
    runLoud('npm run build', { cwd: ROOT, env });
  } else {
    console.log('Static site — skipping build.');
  }

  // --- Clone gh-pages ---
  cloneGhPages(remote);

  if (versionStrategy === 'tagged') {
    // Remove everything except .git
    const entries = readdirSync(DEPLOY_DIR, { withFileTypes: false });
    for (const entry of entries) {
      if (entry === '.git') continue;
      rmSync(join(DEPLOY_DIR, entry), { recursive: true, force: true });
    }

    copyBuildOutput(buildOutDir, DEPLOY_DIR);
    writeFileSync(join(DEPLOY_DIR, '.nojekyll'), '');

    gitLoud(['add', '-A'], { cwd: DEPLOY_DIR });

    try {
      gitLoud(['commit', '-m', `Deploy v${version}`], { cwd: DEPLOY_DIR });
    } catch {
      console.log('No changes to commit on gh-pages.');
    }

    const deployTag = `deploy/v${version}`;
    if (!tagExists(deployTag, DEPLOY_DIR)) {
      try {
        gitLoud(['tag', deployTag], { cwd: DEPLOY_DIR });
        gitLoud(['push', 'origin', deployTag], { cwd: DEPLOY_DIR });
      } catch {
        console.log(`Tag ${deployTag} may already exist on remote — skipping.`);
      }
    }

    gitLoud(['push', 'origin', 'gh-pages'], { cwd: DEPLOY_DIR });

  } else {
    // multi-live
    const versionDir = join(DEPLOY_DIR, `v${version}`);
    mkdirSync(versionDir, { recursive: true });

    copyBuildOutput(buildOutDir, versionDir);

    const redirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=v${version}/">
  <title>Redirecting...</title>
</head>
<body>
  <p>Redirecting to <a href="v${version}/">latest version (v${version})</a>...</p>
</body>
</html>
`;
    writeFileSync(join(DEPLOY_DIR, 'index.html'), redirectHtml);
    writeFileSync(join(DEPLOY_DIR, '.nojekyll'), '');

    gitLoud(['add', '-A'], { cwd: DEPLOY_DIR });

    try {
      gitLoud(['commit', '-m', `Deploy v${version}`], { cwd: DEPLOY_DIR });
    } catch {
      console.log('No changes to commit on gh-pages.');
    }

    gitLoud(['push', 'origin', 'gh-pages'], { cwd: DEPLOY_DIR });
  }

  // --- Tag source branch ---
  const sourceTag = `v${version}`;
  if (!tagExists(sourceTag, ROOT)) {
    try {
      gitLoud(['tag', sourceTag], { cwd: ROOT });
      gitLoud(['push', 'origin', sourceTag], { cwd: ROOT });
    } catch {
      console.log(`Tag ${sourceTag} may already exist on remote — skipping.`);
    }
  } else {
    console.log(`Tag ${sourceTag} already exists on source branch — skipping.`);
  }

  // --- Cleanup ---
  rmSync(DEPLOY_DIR, { recursive: true, force: true });

  // --- Update state ---
  config.lastDeployedVersion = version;
  writeConfig(config);

  console.log(`\nDone! v${version} deployed to GitHub Pages.`);
}

main();

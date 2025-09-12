#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runOut(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

function usage() {
  console.log(`\nUsage:\n  npm run release -- <patch|minor|major|X.Y.Z> [--push] [--commit-all] [--tag-prefix v] [--force]\n\nExamples:\n  npm run release -- patch --push\n  npm run release -- 2.9.0 --push\n  npm run release -- minor --commit-all\n`);
}

function parseArgs(argv) {
  const args = { bump: null, push: false, commitAll: false, tagPrefix: 'v', force: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--push') args.push = true;
    else if (a === '--commit-all') args.commitAll = true;
    else if (a === '--force') args.force = true;
    else if (a === '--tag-prefix') args.tagPrefix = argv[++i];
    else if (!args.bump) args.bump = a;
    else rest.push(a);
  }
  if (!args.bump || rest.length) return null;
  return args;
}

function isSemver(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/.test(v);
}

function bumpSemver(cur, bump) {
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
  if (!m) throw new Error(`Invalid current version in package.json: ${cur}`);
  let [major, minor, patch] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  if (bump === 'major') { major++; minor = 0; patch = 0; }
  else if (bump === 'minor') { minor++; patch = 0; }
  else if (bump === 'patch') { patch++; }
  else throw new Error(`Unsupported bump: ${bump}`);
  return `${major}.${minor}.${patch}`;
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function ensureClean(force) {
  if (force) return;
  const status = runOut('git status --porcelain').trim();
  if (status) {
    console.error('\nError: Working tree is not clean. Commit or stash changes, or pass --force/--commit-all.');
    process.exit(1);
  }
}

function updatePackageLock(lockPath, newVersion) {
  if (!existsSync(lockPath)) return;
  try {
    const lock = readJson(lockPath);
    lock.version = newVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = newVersion;
    }
    writeJson(lockPath, lock);
  } catch (e) {
    console.warn('Warning: Failed to update package-lock.json:', e.message);
  }
}

(function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return usage();

  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const lockPath = path.resolve(process.cwd(), 'package-lock.json');
  const pkg = readJson(pkgPath);
  const current = pkg.version;

  ensureClean(args.force || args.commitAll);

  let next;
  if (isSemver(args.bump)) next = args.bump;
  else if (['major', 'minor', 'patch'].includes(args.bump)) next = bumpSemver(current, args.bump);
  else {
    console.error('Error: Provide bump type (patch|minor|major) or explicit version X.Y.Z');
    process.exit(1);
  }

  // Update package files
  pkg.version = next;
  writeJson(pkgPath, pkg);
  if (existsSync(lockPath)) updatePackageLock(lockPath, next);

  // Stage files
  if (args.commitAll) run('git add -A');
  else {
    run(`git add ${JSON.stringify(pkgPath)}${existsSync(lockPath) ? ' ' + JSON.stringify(lockPath) : ''}`);
  }

  const tag = `${args.tagPrefix}${next}`;
  const msg = `release: ${tag}`;
  run(`git commit -m ${JSON.stringify(msg)}`);
  run(`git tag -a ${JSON.stringify(tag)} -m ${JSON.stringify(tag)}`);

  if (args.push) {
    try {
      run('git push --follow-tags');
    } catch (e) {
      console.error('Warning: git push failed. You may need to set upstream and push manually.');
    }
  }

  console.log(`\nBumped ${current} -> ${next}\nCreated tag ${tag}\n`);
})();


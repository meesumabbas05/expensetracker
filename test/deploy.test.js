import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const deployScript = path.resolve('scripts/deploy.sh');
const ecosystem = readFileSync(new URL('../ecosystem.config.json', import.meta.url), 'utf8');

function fixture({ previous = false, failStart = false, failInstall = false, foreignProcess = false, missingRsync = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'expense-deploy-'));
  const app = path.join(realpathSync(root), 'app');
  const stage = path.join(root, 'stage');
  const bin = path.join(root, 'bin');
  const stateFile = path.join(root, 'pm2-state.json');
  for (const dir of [app, stage, bin]) mkdirSync(dir);
  symlinkSync(process.execPath, path.join(bin, 'node'));
  for (const dir of [app, stage]) {
    mkdirSync(path.join(dir, 'src'));
    mkdirSync(path.join(dir, 'node_modules'));
  }
  writeFileSync(path.join(stage, 'src/config.js'), 'export function readConfig() {}\n');
  writeFileSync(path.join(stage, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(stage, 'package-lock.json'), '{}');
  writeFileSync(path.join(stage, 'ecosystem.config.json'), ecosystem);
  writeFileSync(path.join(stage, '.env'), 'NEW_CONFIG=true\n');
  writeFileSync(path.join(stage, 'node_modules/marker'), 'new dependencies');
  mkdirSync(path.join(app, 'data'));
  writeFileSync(path.join(app, 'data/sessions.json'), 'preserved pending prompts');
  if (previous) {
    writeFileSync(path.join(app, 'src/config.js'), 'old source');
    writeFileSync(path.join(app, 'package.json'), 'old package');
    writeFileSync(path.join(app, 'package-lock.json'), 'old lock');
    writeFileSync(path.join(app, 'ecosystem.config.json'), ecosystem);
    writeFileSync(path.join(app, '.env'), 'OLD_CONFIG=true\n');
    writeFileSync(path.join(app, 'node_modules/marker'), 'old dependencies');
  }
  const other = { name: 'other-project', pm2_env: { pm_cwd: '/some/other/project', status: 'online' } };
  const processes = [other];
  if (previous || foreignProcess) processes.push({ name: 'expense-tracker', pm2_env: { pm_cwd: foreignProcess ? '/another/expense/project' : app, status: 'online' } });
  writeFileSync(stateFile, JSON.stringify({ processes, calls: [], failStart }));
  writeFileSync(path.join(bin, 'pm2'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.MOCK_PM2_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const [command, name] = process.argv.slice(2);
state.calls.push({ command, name, cwd: process.cwd() });
let output = '', code = 0;
if (command === 'jlist') output = JSON.stringify(state.processes);
else if (command === 'stop') state.processes.find(p => p.name === name).pm2_env.status = 'stopped';
else if (command === 'delete') state.processes = state.processes.filter(p => p.name !== name);
else if (command === 'startOrRestart') {
  const config = JSON.parse(fs.readFileSync(name, 'utf8'));
  if (config.apps.length !== 1 || config.apps[0].instances !== 1 || config.apps[0].exec_mode !== 'fork') code = 1;
  else if (state.failStart) { state.failStart = false; code = 1; }
  else {
    state.processes = state.processes.filter(p => p.name !== 'expense-tracker');
    state.processes.push({ name: 'expense-tracker', pm2_env: { pm_cwd: process.cwd(), status: 'online' } });
  }
} else if (!['ping', 'save'].includes(command)) code = 1;
fs.writeFileSync(file, JSON.stringify(state));
if (output) console.log(output);
process.exit(code);
`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nif [ "$MOCK_FAIL_INSTALL" = yes ] && [ "$1" = ci ]; then exit 1; fi\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return {
    app,
    run: () => spawnSync('/bin/bash', [deployScript, stage, app], { encoding: 'utf8', env: { ...process.env, PATH: missingRsync ? bin : `${bin}:${process.env.PATH}`, MOCK_PM2_STATE: stateFile, MOCK_FAIL_INSTALL: failInstall ? 'yes' : 'no' } }),
    state: () => JSON.parse(readFileSync(stateFile, 'utf8')),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

function checkOtherProject(state) {
  assert.deepEqual(state.processes.find(p => p.name === 'other-project'), { name: 'other-project', pm2_env: { pm_cwd: '/some/other/project', status: 'online' } });
  assert.ok(state.calls.filter(c => ['stop', 'delete'].includes(c.command)).every(c => c.name === 'expense-tracker'));
}

test('first PM2 deployment starts one instance and preserves existing application state', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.state().processes.filter(p => p.name === 'expense-tracker').length, 1);
    assert.equal(readFileSync(path.join(f.app, '.env'), 'utf8'), 'NEW_CONFIG=true\n');
    assert.equal(readFileSync(path.join(f.app, 'data/sessions.json'), 'utf8'), 'preserved pending prompts');
    assert.ok(f.state().calls.some(c => c.command === 'save'));
    checkOtherProject(f.state());
  } finally { f.cleanup(); }
});

test('missing rsync fails before changing files or contacting PM2', () => {
  const f = fixture({ previous: true, missingRsync: true });
  try {
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing deployment command: rsync/);
    assert.equal(readFileSync(path.join(f.app, 'src/config.js'), 'utf8'), 'old source');
    assert.equal(readFileSync(path.join(f.app, '.env'), 'utf8'), 'OLD_CONFIG=true\n');
    assert.equal(f.state().processes.find(p => p.name === 'expense-tracker').pm2_env.status, 'online');
    assert.deepEqual(f.state().calls, []);
    checkOtherProject(f.state());
  } finally { f.cleanup(); }
});

test('failed update restores old files, credentials and the existing PM2 process', () => {
  const f = fixture({ previous: true, failStart: true });
  try {
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(path.join(f.app, 'src/config.js'), 'utf8'), 'old source');
    assert.equal(readFileSync(path.join(f.app, 'node_modules/marker'), 'utf8'), 'old dependencies');
    assert.equal(readFileSync(path.join(f.app, '.env'), 'utf8'), 'OLD_CONFIG=true\n');
    assert.equal(f.state().processes.find(p => p.name === 'expense-tracker').pm2_env.status, 'online');
    checkOtherProject(f.state());
  } finally { f.cleanup(); }
});

test('failed first deployment removes the unsuccessful process without starting an empty app', () => {
  const f = fixture({ failStart: true });
  try {
    assert.notEqual(f.run().status, 0);
    assert.ok(!f.state().processes.some(p => p.name === 'expense-tracker'));
    assert.equal(f.state().calls.filter(c => c.command === 'startOrRestart').length, 1);
    assert.equal(readFileSync(path.join(f.app, 'data/sessions.json'), 'utf8'), 'preserved pending prompts');
    checkOtherProject(f.state());
  } finally { f.cleanup(); }
});

test('failed dependency installation does not stop or replace the existing app', () => {
  const f = fixture({ previous: true, failInstall: true });
  try {
    assert.notEqual(f.run().status, 0);
    assert.equal(readFileSync(path.join(f.app, '.env'), 'utf8'), 'OLD_CONFIG=true\n');
    assert.ok(!f.state().calls.some(c => ['stop', 'delete', 'startOrRestart'].includes(c.command)));
    checkOtherProject(f.state());
  } finally { f.cleanup(); }
});

test('deployment refuses to stop an identically named process belonging to another project', () => {
  const f = fixture({ foreignProcess: true });
  try {
    assert.notEqual(f.run().status, 0);
    assert.ok(!f.state().calls.some(c => ['stop', 'delete', 'startOrRestart'].includes(c.command)));
    assert.equal(f.state().processes.find(p => p.name === 'expense-tracker').pm2_env.pm_cwd, '/another/expense/project');
  } finally { f.cleanup(); }
});

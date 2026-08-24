const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { isSafeWindowsVolume, windowsDriveRoot } = require('../platform.cjs');

const root = path.resolve(__dirname, '..');

test('ships a 7-Zip binary for every release target', () => {
  for (const executable of [
    'node_modules/7zip-bin/linux/x64/7za',
    'node_modules/7zip-bin/win/x64/7za.exe',
    'node_modules/7zip-bin/mac/arm64/7za'
  ]) assert.ok(fs.statSync(path.join(root, executable)).size > 500_000, executable);
  if (process.platform !== 'win32') {
    for (const executable of ['node_modules/7zip-bin/linux/x64/7za', 'node_modules/7zip-bin/mac/arm64/7za']) {
      assert.ok(fs.statSync(path.join(root, executable)).mode & 0o100, `${executable} must be executable`);
    }
  }
  assert.doesNotThrow(() => execFileSync(require('7zip-bin').path7za, ['i'], { stdio: 'ignore' }));
});

test('unpacks bundled 7-Zip binaries outside app.asar', () => {
  const forge = require('../forge.config.cjs');
  assert.match(forge.packagerConfig.asar.unpack, /7zip-bin/);
});

test('release workflow packages Linux, Windows, and macOS', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  for (const platform of ['ubuntu-latest', 'windows-latest', 'macos-latest']) assert.match(workflow, new RegExp(platform));
});

test('Windows card selection accepts only a drive root', () => {
  assert.equal(windowsDriveRoot('E:\\'), 'E:\\');
  assert.equal(windowsDriveRoot('e:/'), 'e:\\');
  assert.equal(windowsDriveRoot('E:\\roms'), null);
  assert.equal(windowsDriveRoot('\\\\server\\share'), null);
  assert.equal(windowsDriveRoot('C:'), null);
});

test('Windows safety gate rejects boot, system, and fixed volumes', () => {
  assert.equal(isSafeWindowsVolume({ BusType: 'USB', DriveType: 'Fixed', IsBoot: false, IsSystem: false }), true);
  assert.equal(isSafeWindowsVolume({ BusType: 'SD', DriveType: 'Removable', IsBoot: false, IsSystem: false }), true);
  assert.equal(isSafeWindowsVolume({ BusType: 'SATA', DriveType: 'Fixed', IsBoot: false, IsSystem: false }), false);
  assert.equal(isSafeWindowsVolume({ BusType: 'USB', DriveType: 'Removable', IsBoot: true, IsSystem: false }), false);
  assert.equal(isSafeWindowsVolume({ BusType: 'USB', DriveType: 'Removable', IsBoot: false, IsSystem: true }), false);
});

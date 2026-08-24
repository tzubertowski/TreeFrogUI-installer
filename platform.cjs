const path = require('node:path');

function windowsDriveRoot(card) {
  const resolved = path.win32.resolve(String(card || ''));
  const root = path.win32.parse(resolved).root;
  if (!/^[A-Za-z]:\\$/.test(root) || resolved.toLowerCase() !== root.toLowerCase()) return null;
  return root;
}

function isSafeWindowsVolume(volume) {
  const removable = volume?.DriveType === 'Removable' || ['USB', 'SD', 'MMC'].includes(volume?.BusType);
  return removable && volume?.IsBoot !== true && volume?.IsSystem !== true;
}

module.exports = { isSafeWindowsVolume, windowsDriveRoot };

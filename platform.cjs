function windowsDriveRoot(card) {
  const selected = String(card || '');
  if (!/^[A-Za-z]:[\\/]$/.test(selected)) return null;
  return `${selected[0]}:\\`;
}

function isSafeWindowsVolume(volume) {
  const removable = volume?.DriveType === 'Removable' || ['USB', 'SD', 'MMC'].includes(volume?.BusType);
  return removable && volume?.IsBoot !== true && volume?.IsSystem !== true;
}

module.exports = { isSafeWindowsVolume, windowsDriveRoot };

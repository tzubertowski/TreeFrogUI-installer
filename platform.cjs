function windowsDriveRoot(card) {
  const selected = String(card || '');
  if (!/^[A-Za-z]:[\\/]$/.test(selected)) return null;
  return `${selected[0]}:\\`;
}

function isSafeWindowsVolume(volume) {
  const removable = volume?.DriveType === 'Removable' || ['USB', 'SD', 'MMC'].includes(volume?.BusType);
  return removable && volume?.IsBoot !== true && volume?.IsSystem !== true;
}

function linuxRootDevice(blockDevices, source) {
  const byName = new Map((blockDevices || []).map((device) => [String(device.path || '').split('/').pop(), device]));
  let device = (blockDevices || []).find((item) => item.path === source);
  if (!device) return null;
  while (device.pkname && byName.has(device.pkname)) device = byName.get(device.pkname);
  return device;
}

function isSafeLinuxBlockDevice(blockDevices, source) {
  const selected = (blockDevices || []).find((device) => device.path === source);
  const root = linuxRootDevice(blockDevices, source);
  if (!selected || !root || root.type !== 'disk') return false;
  // Most cards contain one partition, while stock SF3000 cards put FAT32
  // directly on the removable disk. Accept the latter only when lsblk reports
  // an actual filesystem; an unformatted whole disk remains ineligible.
  const filesystemTarget = selected.type === 'part' ||
    (selected.type === 'disk' && selected.path === root.path && Boolean(selected.fstype));
  if (!filesystemTarget) return false;
  const removable = root.rm === true && (['usb', 'mmc'].includes(String(root.tran || '').toLowerCase()) || /^\/dev\/mmcblk/.test(root.path || ''));
  if (!removable) return false;
  const rootName = String(root.path || '').split('/').pop();
  const onRoot = (device) => linuxRootDevice(blockDevices, device.path)?.path?.split('/').pop() === rootName;
  const systemMount = (blockDevices || []).filter(onRoot).flatMap((device) => device.mountpoints || [])
    .some((mount) => mount === '/' || mount === '/boot' || mount === '/boot/efi');
  return !systemMount;
}

module.exports = { isSafeLinuxBlockDevice, isSafeWindowsVolume, windowsDriveRoot };

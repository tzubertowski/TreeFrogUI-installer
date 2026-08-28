const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { path7za } = require('7zip-bin');
const { isSafeLinuxBlockDevice, isSafeWindowsVolume, windowsDriveRoot } = require('./platform.cjs');
const execFileAsync = promisify(execFile);

const devices = {
  r36sx26: { label: 'R36SX · v2.6', family: 'R36SX', install: 'r36sx', labelName: 'R36SX', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/R36SX_v2.6_stock.7z' },
  r36sx27: { label: 'R36SX · v2.7', family: 'R36SX', install: 'r36sx', labelName: 'R36SX', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/R36SX_v2.7_stock.7z' },
  // R36HD is an R36SX-compatible clone.  Use the proven R36SX hook (including
  // its driver fallback); the dedicated r36hd hook lacks that boot path.
  r36hd: { label: 'R36HD', family: 'R36HD', install: 'r36sx', labelName: 'R36HD', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/R36SX_v2.6_stock.7z' },
  sf3000: { label: 'SF3000', family: 'SF3000', install: 'sf3000', labelName: 'SF3000', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/SF3000_stock.7z' },
  sf3000hd: { label: 'SF3000 HD', family: 'SF3500', install: 'sf3000hd', labelName: 'SF3000HD', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/SF3000_HD_stock.7z' },
  sf3100: { label: 'SF3100', family: 'SF3500', install: 'sf3100', labelName: 'SF3100', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/SF3100_stock.7z' },
  sf3500: { label: 'SF3500', family: 'SF3500', install: 'sf3500', labelName: 'SF3500', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/SF3500_stock.7z', stockPage: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/tag/stock-backups-v1' },
  gb350: { label: 'GB350', family: 'GB350', install: 'gb350', labelName: 'GB350', stock: 'https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/GB350_stock.7z' }
};

let win;
let cancelled = false;
function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }
function progress(message, percent) { send('install:progress', { message, percent }); }
function createWindow() {
  win = new BrowserWindow({ width: 900, height: 720, minWidth: 700, minHeight: 600, backgroundColor: '#101318', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}
async function download(url, target, onProgress) {
  const controller = new AbortController();
  let idleTimer;
  const resetIdleTimeout = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(new Error('Download stalled for 30 seconds.')), 30000);
  };
  resetIdleTimeout();
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'TreeFrogUI-Installer' }, redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    if (!response.body) throw new Error('Download returned no data.');
    const total = Number(response.headers.get('content-length')) || null;
    let received = 0;
    const monitor = new Transform({
      transform(chunk, _encoding, callback) {
        resetIdleTimeout();
        received += chunk.length;
        onProgress?.({ received, total });
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), monitor, fs.createWriteStream(target));
    if (received < 1024) throw new Error('The downloaded backup was unexpectedly small. Check the backup link.');
  } finally { clearTimeout(idleTimer); }
}
function cacheName(value) { return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24); }
async function cachedDownload(url, category, identity, onProgress) {
  const directory = path.join(app.getPath('userData'), 'cache', category);
  await fsp.mkdir(directory, { recursive: true });
  const extension = category === 'releases' ? '.zip' : '.bin';
  const target = path.join(directory, `${cacheName(identity)}${extension}`);
  const markerPath = `${target}.json`;
  let remoteMarker = url;
  try {
    const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'TreeFrogUI-Installer' }, redirect: 'follow', signal: AbortSignal.timeout(3000) });
    remoteMarker = head.headers.get('etag') || head.headers.get('last-modified') || url;
  } catch { /* a cached file can still be used offline */ }
  try {
    const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
    await fsp.access(target);
    // If the metadata probe timed out, prefer the existing archive rather than
    // making the user wait for a second full download.
    if (marker.url === url && (marker.remoteMarker === remoteMarker || remoteMarker === url)) return { path: target, cached: true };
  } catch { /* cache miss */ }
  const temporary = `${target}.part`;
  await fsp.rm(temporary, { force: true });
  await download(url, temporary, onProgress);
  await fsp.rename(temporary, target);
  await fsp.writeFile(markerPath, JSON.stringify({ url, remoteMarker, identity }));
  if (category === 'releases') {
    for (const file of await fsp.readdir(directory)) {
      if (file.endsWith('.zip') && path.join(directory, file) !== target) await fsp.rm(path.join(directory, file), { force: true });
      if (file.endsWith('.zip.json') && path.join(directory, file) !== markerPath) await fsp.rm(path.join(directory, file), { force: true });
    }
  }
  return { path: target, cached: false };
}
async function command(program, args, options = {}) {
  return execFileAsync(program, args, { maxBuffer: 16 * 1024 * 1024, ...options });
}
async function chooseCard() {
  const result = await dialog.showOpenDialog(win, { title: 'Select the mounted SD card', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
}
function powershell(script) {
  return command('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${script}`]);
}
async function linuxBlockDevices() {
  const { stdout } = await command('lsblk', ['-J', '-b', '-o', 'PATH,TYPE,SIZE,MODEL,FSTYPE,LABEL,RM,TRAN,MOUNTPOINTS,PKNAME']);
  return JSON.parse(stdout).blockdevices || [];
}
async function assertSafeLinuxSource(source) {
  const blockDevices = await linuxBlockDevices();
  if (!isSafeLinuxBlockDevice(blockDevices, source)) throw new Error('Safety check refused to format a non-removable or system block device.');
}
async function inspectCard(card) {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await command('findmnt', ['-J', '-T', card, '-o', 'SOURCE,TARGET']);
      const mount = JSON.parse(stdout).filesystems?.[0];
      const source = mount?.source;
      const selectedRoot = await fsp.realpath(card);
      const mountRoot = mount?.target ? await fsp.realpath(mount.target) : null;
      const blockDevices = await linuxBlockDevices();
      const device = blockDevices.find((item) => item.path === source);
      const safe = selectedRoot === mountRoot && isSafeLinuxBlockDevice(blockDevices, source);
      const size = device?.size ? `${(device.size / 1e9).toFixed(1)} GB` : 'size unknown';
      const details = [device?.label, device?.fstype, size, device?.model].filter(Boolean).join(' · ');
      return { card: mountRoot || card, source, platform: process.platform, details, formatSupported: safe,
        removable: safe, hint: safe ? '' : 'Select the root of a mounted removable USB/SD card. Internal and system disks are always refused.' };
    }
    if (process.platform === 'darwin') {
      const { stdout } = await command('df', ['-P', card]);
      const source = stdout.trim().split(/\s+/)[0];
      const details = await command('diskutil', ['info', source]);
      return { card, source, platform: process.platform, details: details.stdout.trim(), formatSupported: source.startsWith('/dev/') };
    }
    if (process.platform === 'win32') {
      const root = windowsDriveRoot(card);
      if (!root) throw new Error('Select the drive root.');
      const drive = root[0];
      const { stdout } = await powershell(`$volume = Get-Volume -DriveLetter '${drive}'; $partition = Get-Partition -DriveLetter '${drive}'; $disk = $partition | Get-Disk; [pscustomobject]@{ FileSystemLabel=$volume.FileSystemLabel; FileSystem=$volume.FileSystem; Size=$volume.Size; DriveType="$($volume.DriveType)"; BusType="$($disk.BusType)"; IsBoot=$partition.IsBoot; IsSystem=$partition.IsSystem; DiskNumber=$disk.Number } | ConvertTo-Json -Compress`);
      const volume = JSON.parse(stdout);
      const removable = volume.DriveType === 'Removable' || ['USB', 'SD', 'MMC'].includes(volume.BusType);
      const safe = isSafeWindowsVolume(volume);
      return { card: root, source: root, platform: process.platform,
        details: `${volume.FileSystemLabel || ''} · ${volume.FileSystem || 'unknown'} · ${volume.Size ? Math.round(volume.Size / 1e9) + ' GB' : 'size unknown'} · ${volume.BusType || volume.DriveType || 'unknown bus'}`,
        formatSupported: safe, removable, diskNumber: volume.DiskNumber,
        hint: safe ? '' : 'This volume is not identified as a removable USB/SD card, so the installer will not erase it.' };
    }
  } catch { /* fall through to the unsupported-card message */ }
  const hint = process.platform === 'win32'
    ? 'Windows could not identify this drive. Select the SD card drive root, not a subfolder.'
    : process.platform === 'darwin'
      ? 'macOS could not identify this volume. Select the mounted SD card volume.'
      : 'Linux could not identify a mounted removable volume.';
  return { card, source: null, platform: process.platform, details: '', hint, formatSupported: false };
}
async function latestRelease(preRelease = false) {
  const endpoint = preRelease ? 'https://api.github.com/repos/tzubertowski/treefrog-ui/releases?per_page=30' : 'https://api.github.com/repos/tzubertowski/treefrog-ui/releases/latest';
  const response = await fetch(endpoint, { headers: { 'User-Agent': 'TreeFrogUI-Installer', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`TreeFrogUI release lookup failed (${response.status})`);
  const releases = await response.json();
  const release = preRelease ? releases.find((item) => item.prerelease && !item.draft) : releases;
  if (!release) throw new Error('No TreeFrogUI prerelease is currently available.');
  const asset = release.assets.find((item) => /^TreeFrogUI_.*\.zip$/i.test(item.name));
  if (!asset) throw new Error('The latest TreeFrogUI release has no full installation ZIP.');
  const update = release.assets.find((item) => /^update\.zip$/i.test(item.name));
  return { tag: release.tag_name, name: asset.name, url: asset.browser_download_url,
    updateName: update?.name || null, updateUrl: update?.browser_download_url || null,
    prerelease: Boolean(release.prerelease) };
}
function versionParts(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[_-]?([a-z0-9]+))?$/i);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), suffix: (match[4] || '').toLowerCase() };
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) return null;
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key];
  if (!a.suffix && b.suffix) return 1;
  if (a.suffix && !b.suffix) return -1;
  return a.suffix.localeCompare(b.suffix, undefined, { numeric: true });
}
async function cardVersion(card) {
  try { return (await fsp.readFile(path.join(card, 'cubegm', 'version.txt'), 'utf8')).trim(); }
  catch { return null; }
}
async function checkUpdate({ card, preRelease }) {
  const current = await cardVersion(card);
  if (!current) return { legacy: true, available: false, current: null };
  const release = await latestRelease(preRelease === true);
  const comparison = compareVersions(release.tag, current);
  if (comparison === null) return { legacy: true, available: false, current };
  return { legacy: false, available: comparison > 0, current, release,
    reason: comparison > 0 ? '' : 'Your card is already running this release or a newer one.' };
}
async function extractArchive(archive, destination) {
  const executable = app.isPackaged ? path7za.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`) : path7za;
  try { await command(executable, ['x', '-y', archive, `-o${destination}`]); }
  catch (error) { throw new Error(`Could not extract ${path.basename(archive)} with the bundled 7-Zip tool. ${error instanceof Error ? error.message : String(error)}`); }
}
async function copyTree(source, destination, onFile) {
  await new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    const child = windows
      ? spawn('robocopy', [source, destination, '/E', '/COPY:DAT', '/R:1', '/W:1'], { stdio: ['ignore', 'pipe', 'pipe'] })
      : spawn('cp', ['-a', '-v', `${source}/.`, destination], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let error = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) onFile?.(line.trim().replace(/^.* -> /, ''));
    });
    child.stderr.on('data', (chunk) => { error += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (windows ? code <= 7 : code === 0) ? resolve() : reject(new Error(error.trim() || `Copy failed (${code})`)));
  });
}
async function archiveRoot(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isDirectory() && entry.name === 'cubegm')) return directory;
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const candidate = await archiveRoot(path.join(directory, entry.name));
    if (candidate) return candidate;
  }
  return null;
}
async function formatCard(source, label) {
  if (process.platform === 'darwin') {
    await command('diskutil', ['unmount', source]);
    await command('diskutil', ['eraseVolume', 'MS-DOS', label, source]);
    return source;
  }
  if (process.platform === 'win32') {
    const root = windowsDriveRoot(source);
    if (!root) throw new Error('Windows lost the selected SD card drive. Select its drive root again.');
    const drive = root[0];
    const { stdout } = await powershell(`Format-Volume -DriveLetter '${drive}' -FileSystem FAT32 -AllocationUnitSize 32768 -NewFileSystemLabel '${label}' -Force -Confirm:$false | Out-Null; $volume = Get-Volume -DriveLetter '${drive}'; if ($volume.FileSystem -ne 'FAT32') { throw "Expected FAT32 after formatting, found $($volume.FileSystem)" }; $volume.FileSystem`);
    if (stdout.trim() !== 'FAT32') throw new Error('Windows did not confirm the FAT32 format.');
    return root;
  }
  await assertSafeLinuxSource(source);
  // Explicit confirmation happens in the renderer before this IPC call.
  // udisksctl uses the desktop's polkit agent and does not require a root
  // umount. This avoids pkexec's non-interactive authorization failure.
  try {
    await command('udisksctl', ['unmount', '-b', source]);
  } catch {
    await command('pkexec', ['umount', source]);
  }
  await command('pkexec', ['mkfs.vfat', '-F', '32', '-n', label, source]);
  const { stdout, stderr } = await command('udisksctl', ['mount', '-b', source]);
  const output = `${stdout}\n${stderr}`;
  const match = output.match(/\bat\s+(.+?)(?:\.\s*)?$/m);
  if (match?.[1]?.trim()) return match[1].trim();
  try {
    const mounted = await command('findmnt', ['-no', 'TARGET', '-S', source]);
    if (mounted.stdout.trim()) return mounted.stdout.trim();
  } catch { /* report the useful installer error below */ }
  throw new Error(`The card was formatted, but could not be mounted again. ${output.trim()}`);
}
async function ejectCard(source) {
  try {
    if (process.platform === 'linux') await command('udisksctl', ['unmount', '-b', source]);
    else if (process.platform === 'darwin') await command('diskutil', ['eject', source]);
    else if (process.platform === 'win32') {
      const root = windowsDriveRoot(source);
      if (!root) throw new Error('The Windows drive is no longer available.');
      await command('mountvol.exe', [root, '/p']);
    }
    return true;
  } catch (error) { progress('Installation complete — eject the SD card manually.', 99); return false; }
}
async function install({ deviceId, card, source, confirmed, preRelease }) {
  if (!confirmed) throw new Error('Formatting was not confirmed.');
  const device = devices[deviceId];
  if (!device) throw new Error('Unknown device.');
  if (!device.stock) throw new Error(`${device.label} backup is not configured yet. Open the stock-backup page to choose the correct revision.`);
  cancelled = false;
  const verified = await inspectCard(card);
  if (!verified.formatSupported || verified.source !== source) throw new Error(verified.hint || 'The selected SD card could not be verified again.');
  source = verified.source;
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'treefrog-installer-'));
  try {
    progress('Checking cached stock backup…', 8);
    const stock = await cachedDownload(device.stock, 'stock', deviceId, ({ received, total }) => progress(`Downloading stock backup… ${Math.round(received / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? Math.min(20, 8 + (received / total) * 12) : 12));
    const stockArchive = stock.path;
    progress(stock.cached ? 'Using cached stock backup.' : 'Downloading the stock backup…', 12);
    if (cancelled) throw new Error('Installation cancelled.');
    progress('Checking GitHub for the selected TreeFrogUI channel…', 22);
    const release = await latestRelease(preRelease === true);
    progress(`Downloading TreeFrogUI ${release.tag}…`, 25);
    const releaseCache = await cachedDownload(release.url, 'releases', release.name, ({ received, total }) => progress(`Downloading TreeFrogUI ${release.tag}… ${Math.round(received / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? Math.min(35, 25 + (received / total) * 10) : 30));
    const treefrogArchive = releaseCache.path;
    progress(releaseCache.cached ? `Using cached ${release.tag} release.` : `Downloaded ${release.tag} release.`, 30);
    progress('Formatting the SD card (FAT32)…', 38);
    let mount;
    try { mount = await formatCard(source, device.labelName); } catch (error) {
      const platformHint = process.platform === 'win32'
        ? 'Windows needs administrator permission to format the drive. Restart the installer as Administrator and try again.'
        : process.platform === 'darwin'
          ? 'macOS needs authorization to erase the volume. Approve the system prompt and try again.'
          : 'Linux needs administrator authorization to format the card. Approve the polkit prompt and try again.';
      throw new Error(`${platformHint}\n${error instanceof Error ? error.message : String(error)}`);
    }
    progress('Restoring the clean stock backup…', 58);
    const stockDir = path.join(work, 'stock'); await fsp.mkdir(stockDir); await extractArchive(stockArchive, stockDir);
    const stockRoot = await archiveRoot(stockDir); if (!stockRoot) throw new Error('The stock backup does not contain a cubegm/ directory.');
    let stockFiles = 0;
    await copyTree(stockRoot, mount, (file) => { stockFiles += 1; progress(`Restoring stock backup… ${path.basename(file)}`, Math.min(72, 58 + stockFiles / 20)); });
    progress(`Installing TreeFrogUI ${release.tag}…`, 76);
    const tfDir = path.join(work, 'treefrog'); await fsp.mkdir(tfDir); await extractArchive(treefrogArchive, tfDir);
    const releaseRoot = await archiveRoot(tfDir); if (!releaseRoot) throw new Error('The TreeFrogUI archive has no release/ payload.');
    let releaseFiles = 0;
    await copyTree(releaseRoot, mount, (file) => { releaseFiles += 1; progress(`Installing TreeFrogUI… ${path.basename(file)}`, Math.min(90, 76 + releaseFiles / 20)); });
    const deviceOverlay = path.join(releaseRoot, 'install_first', device.install);
    if (!fs.existsSync(deviceOverlay)) throw new Error(`The TreeFrogUI release has no ${device.install} device overlay.`);
    await copyTree(deviceOverlay, mount, (file) => progress(`Applying ${device.label} boot files… ${path.basename(file)}`, 94));
    progress('Ejecting the SD card…', 97);
    const ejected = await ejectCard(source);
    progress('Finished — enjoy TreeFrogUI!', 100);
    return { release: release.tag, mount, device: device.label, prerelease: release.prerelease, ejected };
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}
async function update({ deviceId, card, source, preRelease }) {
  const verified = await inspectCard(card);
  if (!verified.formatSupported || verified.source !== source) throw new Error(verified.hint || 'The selected SD card could not be verified again.');
  source = verified.source;
  const status = await checkUpdate({ card, preRelease });
  if (status.legacy) throw new Error('This card is running a build without a version marker. Please install the latest TreeFrogUI release first.');
  if (!status.available) return { updated: false, current: status.current, release: status.release?.tag || null, reason: status.reason };
  if (!status.release.updateUrl) throw new Error(`TreeFrogUI ${status.release.tag} does not provide an update archive yet. Install the full release instead.`);
  cancelled = false;
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'treefrog-update-'));
  try {
    progress(`Downloading TreeFrogUI ${status.release.tag} update…`, 12);
    const archive = await cachedDownload(status.release.updateUrl, 'releases', `${status.release.tag}-${status.release.updateName}`, ({ received, total }) => progress(`Downloading TreeFrogUI ${status.release.tag} update… ${Math.round(received / 1048576)}${total ? ` / ${Math.round(total / 1048576)}` : ''} MB`, total ? Math.min(25, 12 + (received / total) * 13) : 18));
    progress('Downloaded update archive.', 25);
    const unpacked = path.join(work, 'update'); await fsp.mkdir(unpacked); await extractArchive(archive.path, unpacked);
    const root = path.join(unpacked, 'treefrog-update');
    if (!fs.existsSync(root)) throw new Error('The update archive has an invalid layout.');
    if (!root || path.basename(root) !== 'treefrog-update') throw new Error('The update archive has an invalid layout.');
    const manifest = await fsp.readFile(path.join(root, 'manifest.txt'), 'utf8').catch(() => '');
    if (!new RegExp(`(?:^|\\n)version=${status.release.tag.replace(/^v/i, '')}(?:\\n|$)`).test(manifest)) throw new Error('The update archive version does not match the selected release.');
    const payload = path.join(root, 'payload');
    let files = 0;
    if (fs.existsSync(payload)) await copyTree(payload, card, (file) => { files += 1; progress(`Updating TreeFrogUI… ${path.basename(file)}`, Math.min(78, 28 + files / 3)); });
    const deletes = async (file) => {
      if (!fs.existsSync(file)) return;
      for (const relative of (await fsp.readFile(file, 'utf8')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
        if (relative.includes('..') || path.isAbsolute(relative)) continue;
        await fsp.rm(path.join(card, relative), { recursive: true, force: true });
      }
    };
    await deletes(path.join(root, 'delete.txt'));
    const device = devices[deviceId];
    if (!device) throw new Error('Choose your device before updating.');
    const deviceRoot = path.join(root, 'device', device.install);
    if (fs.existsSync(deviceRoot)) {
      const devicePayload = path.join(deviceRoot, 'cubegm');
      if (fs.existsSync(devicePayload)) await copyTree(devicePayload, path.join(card, 'cubegm'), (file) => progress(`Applying ${device.label} update… ${path.basename(file)}`, 84));
      await deletes(path.join(deviceRoot, 'delete.txt'));
    }
    progress('Ejecting the SD card…', 96);
    const ejected = await ejectCard(source);
    progress('Update complete.', 100);
    return { updated: true, current: status.current, release: status.release.tag, ejected };
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}

app.whenReady().then(() => {
  createWindow();
  ipcMain.handle('devices:list', () => devices);
  ipcMain.handle('card:choose', chooseCard);
  ipcMain.handle('card:inspect', (_event, card) => inspectCard(card));
  ipcMain.handle('release:latest', (_event, preRelease) => latestRelease(preRelease === true));
  ipcMain.handle('update:check', (_event, input) => checkUpdate(input));
  ipcMain.handle('install:start', (_event, input) => install(input));
  ipcMain.handle('update:start', (_event, input) => update(input));
  ipcMain.handle('install:cancel', () => { cancelled = true; });
  ipcMain.handle('stock:open', (_event, id) => shell.openExternal(devices[id]?.stockPage || devices[id]?.stock || 'https://github.com/tzubertowski/treefrog-ui/blob/main/install.md'));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

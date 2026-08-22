const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const devices = {
  r36sx26: { label: 'R36SX · v2.6', family: 'R36SX', install: 'r36sx', labelName: 'R36SX', stock: 'https://drive.usercontent.google.com/download?id=1xTCNNRKfQmFJr2Zkd1oCBRChuWiidIBD&export=download&confirm=t' },
  r36sx27: { label: 'R36SX · v2.7', family: 'R36SX', install: 'r36sx', labelName: 'R36SX', stock: 'https://drive.usercontent.google.com/download?id=12G3CQAWkaRMWbrY_YmGH8nstGbs1hB-O&export=download&confirm=t' },
  sf3000: { label: 'SF3000', family: 'SF3000', install: 'sf3000', labelName: 'SF3000', stock: 'https://github.com/Q-ta-s/q-ta-s.github.io/releases/download/sf3000/SF3000_sdcard.7z' },
  sf3000hd: { label: 'SF3000 HD', family: 'SF3500', install: 'sf3000hd', labelName: 'SF3000HD', stock: 'https://github.com/Q-ta-s/q-ta-s.github.io/releases/download/sf3000_hd_1/SF3000_HD_sdcard_v1.1.7z' },
  sf3100: { label: 'SF3100', family: 'SF3500', install: 'sf3100', labelName: 'SF3100', stock: 'https://github.com/Q-ta-s/q-ta-s.github.io/releases/download/sf3100/SF3100_sdcard.7z' },
  sf3500: { label: 'SF3500', family: 'SF3500', install: 'sf3500', labelName: 'SF3500', stock: 'https://github.com/Q-ta-s/q-ta-s.github.io/releases/download/sf3500/SF3500_sdcard.7z', stockPage: 'https://github.com/Q-ta-s/q-ta-s.github.io/releases/tag/sf3500' },
  gb350: { label: 'GB350', family: 'GB350', install: 'gb350', labelName: 'GB350', stock: 'https://github.com/Q-ta-s/q-ta-s.github.io/releases/download/gb350/GB350.7z' }
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
async function download(url, target) {
  const response = await fetch(url, { headers: { 'User-Agent': 'TreeFrogUI-Installer' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length < 1024) throw new Error('The downloaded backup was unexpectedly small. Check the backup link.');
  await fsp.writeFile(target, data);
}
async function command(program, args, options = {}) {
  return execFileAsync(program, args, { maxBuffer: 16 * 1024 * 1024, ...options });
}
async function chooseCard() {
  const result = await dialog.showOpenDialog(win, { title: 'Select the mounted SD card', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
}
async function inspectCard(card) {
  if (process.platform !== 'linux') return { card, source: null, platform: process.platform, formatSupported: false };
  try {
    const { stdout } = await command('findmnt', ['-no', 'SOURCE', '-T', card]);
    const source = stdout.trim();
    return { card, source, platform: process.platform, formatSupported: /^\/dev\//.test(source) };
  } catch { return { card, source: null, platform: process.platform, formatSupported: false }; }
}
async function latestRelease() {
  const response = await fetch('https://api.github.com/repos/tzubertowski/treefrog-ui/releases/latest', { headers: { 'User-Agent': 'TreeFrogUI-Installer', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`TreeFrogUI release lookup failed (${response.status})`);
  const release = await response.json();
  const asset = release.assets.find((item) => /^TreeFrogUI_.*\.zip$/i.test(item.name));
  if (!asset) throw new Error('The latest TreeFrogUI release has no full installation ZIP.');
  return { tag: release.tag_name, name: asset.name, url: asset.browser_download_url };
}
async function extractArchive(archive, destination) {
  try { await command('7z', ['x', '-y', archive, `-o${destination}`]); return; } catch (error) {
    if (/\.zip$/i.test(archive)) { await command('unzip', ['-q', '-o', archive, '-d', destination]); return; }
    throw new Error('7-Zip is required to extract this backup. Install p7zip/7z and try again.');
  }
}
async function copyTree(source, destination, onFile) {
  await new Promise((resolve, reject) => {
    const child = spawn('cp', ['-a', '-v', `${source}/.`, destination], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `Copy failed (${code})`)));
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
  // Explicit confirmation happens in the renderer before this IPC call.
  await command('pkexec', ['umount', source]);
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
async function install({ deviceId, card, source, confirmed }) {
  if (!confirmed) throw new Error('Formatting was not confirmed.');
  const device = devices[deviceId];
  if (!device) throw new Error('Unknown device.');
  if (!device.stock) throw new Error(`${device.label} backup is not configured yet. Open the stock-backup page to choose the correct revision.`);
  cancelled = false;
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'treefrog-installer-'));
  try {
    progress('Downloading the stock backup…', 8);
    const stockArchive = path.join(work, 'stock-backup');
    await download(device.stock, stockArchive);
    if (cancelled) throw new Error('Installation cancelled.');
    progress('Downloading the latest TreeFrogUI release…', 22);
    const release = await latestRelease();
    const treefrogArchive = path.join(work, release.name);
    await download(release.url, treefrogArchive);
    progress('Formatting the SD card (FAT32)…', 38);
    const mount = await formatCard(source, device.labelName);
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
    progress('Finished — enjoy TreeFrogUI!', 100);
    return { release: release.tag, mount, device: device.label };
  } finally { await fsp.rm(work, { recursive: true, force: true }); }
}

app.whenReady().then(() => {
  createWindow();
  ipcMain.handle('devices:list', () => devices);
  ipcMain.handle('card:choose', chooseCard);
  ipcMain.handle('card:inspect', (_event, card) => inspectCard(card));
  ipcMain.handle('release:latest', latestRelease);
  ipcMain.handle('install:start', (_event, input) => install(input));
  ipcMain.handle('install:cancel', () => { cancelled = true; });
  ipcMain.handle('stock:open', (_event, id) => shell.openExternal(devices[id]?.stockPage || devices[id]?.stock || 'https://github.com/tzubertowski/treefrog-ui/blob/main/install.md'));
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

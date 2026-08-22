const $ = (id) => document.getElementById(id);
const device = $('device'); const card = $('card'); const info = $('card-info'); const start = $('start'); const confirm = $('confirm');
let devices = {}; let inspection = null; let busy = false;
function showError(message) { $('error').textContent = message; $('error').classList.toggle('hidden', !message); }
function refresh() { start.disabled = busy || !inspection?.formatSupported || !confirm.checked; }
async function boot() {
  devices = await window.treefrogInstaller.devices();
  for (const [id, value] of Object.entries(devices)) { const option = document.createElement('option'); option.value = id; option.textContent = value.label; device.append(option); }
  $('stock').onclick = () => window.treefrogInstaller.openStock(device.value);
  confirm.onchange = refresh;
  $('choose').onclick = async () => { const selected = await window.treefrogInstaller.chooseCard(); if (!selected) return; card.value = selected; inspection = await window.treefrogInstaller.inspectCard(selected); info.textContent = inspection.source ? `Detected device: ${inspection.source}` : 'Could not identify a Linux block device. FAT32 formatting is supported on Linux only.'; refresh(); };
  start.onclick = async () => {
    if (!inspection?.formatSupported) return;
    const okay = window.confirm(`ERASE ${inspection.source}\n\nThis permanently formats the selected SD card as FAT32. Continue?`);
    if (!okay) return;
    busy = true; refresh(); $('progress-card').classList.remove('hidden'); showError('');
    try { const result = await window.treefrogInstaller.start({ deviceId: device.value, card: card.value, source: inspection.source, confirmed: true }); $('done').classList.remove('hidden'); $('done-message').textContent = `${result.device} is ready on ${result.mount}. Safely eject it before putting it in the handheld.`; } catch (error) { showError(error.message || String(error)); } finally { busy = false; refresh(); }
  };
  window.treefrogInstaller.onProgress(({ message, percent }) => { $('progress-title').textContent = message; $('progress-message').textContent = `${percent}%`; $('progress').style.width = `${percent}%`; });
}
boot().catch((error) => showError(error.message || String(error)));

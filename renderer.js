const $ = (id) => document.getElementById(id);
const steps = ['step-1', 'step-2', 'step-3', 'step-progress', 'step-4'];
let devices = {}; let inspection = null; let busy = false;
function showStep(id) { for (const step of steps) $(step).classList.toggle('hidden', step !== id); const active = steps.indexOf(id) + 1; document.querySelectorAll('[data-step-dot]').forEach((dot) => dot.classList.toggle('active', Number(dot.dataset.stepDot) === Math.min(active, 4))); }
function error(message) { $('error').textContent = message || ''; $('error').classList.toggle('hidden', !message); }
function refresh() { $('next-card').disabled = !inspection?.formatSupported; $('start').disabled = busy || !$('confirm').checked; }
async function boot() {
  devices = await window.treefrogInstaller.devices();
  for (const [id, value] of Object.entries(devices)) { const option = document.createElement('option'); option.value = id; option.textContent = value.label; $('device').append(option); }
  $('stock').onclick = () => window.treefrogInstaller.openStock($('device').value);
  $('next-device').onclick = () => showStep('step-2');
  $('back-card').onclick = () => showStep('step-1');
  $('back-install').onclick = () => showStep('step-2');
  $('choose').onclick = async () => { const selected = await window.treefrogInstaller.chooseCard(); if (!selected) return; $('card').value = selected; inspection = await window.treefrogInstaller.inspectCard(selected); $('card-info').textContent = inspection.source ? `Detected device: ${inspection.source}` : 'Could not identify a Linux block device. FAT32 formatting is supported on Linux only.'; refresh(); };
  $('next-card').onclick = () => { if (inspection?.formatSupported) showStep('step-3'); };
  $('confirm').onchange = refresh;
  $('start').onclick = async () => { if (!inspection?.formatSupported || !$('confirm').checked) return; if (!window.confirm(`ERASE ${inspection.source}\n\nThis permanently formats the selected SD card as FAT32. Continue?`)) return; busy = true; showStep('step-progress'); error(''); try { const result = await window.treefrogInstaller.start({ deviceId: $('device').value, card: $('card').value, source: inspection.source, confirmed: true }); $('done-message').textContent = `${result.device} is ready on ${result.mount}. Safely eject it before putting it in the handheld.`; showStep('step-4'); } catch (cause) { busy = false; showStep('step-3'); error(cause.message || String(cause)); refresh(); } };
  window.treefrogInstaller.onProgress(({ message, percent }) => { $('progress-title').textContent = message; $('progress-message').textContent = `${percent}%`; $('progress').style.width = `${percent}%`; });
  showStep('step-1');
}
boot().catch((cause) => error(cause.message || String(cause)));

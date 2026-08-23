const $ = (id) => document.getElementById(id);
const steps = ['step-1', 'step-2', 'step-3', 'step-progress', 'step-4'];
let devices = {}; let inspection = null; let busy = false; let updateStatus = null;
function showStep(id) { for (const step of steps) $(step).classList.toggle('hidden', step !== id); const active = steps.indexOf(id) + 1; document.querySelectorAll('[data-step-dot]').forEach((dot) => dot.classList.toggle('active', Number(dot.dataset.stepDot) === Math.min(active, 4))); }
function error(message) { $('error').textContent = message || ''; $('error').classList.toggle('hidden', !message); }
function refresh() { $('start').disabled = busy || !inspection?.formatSupported || ($('operation').value === 'update' && !updateStatus?.available); }
async function boot() {
  devices = await window.treefrogInstaller.devices();
  for (const [id, value] of Object.entries(devices)) { const option = document.createElement('option'); option.value = id; option.textContent = value.label; $('device').append(option); }
  $('stock').onclick = () => window.treefrogInstaller.openStock($('device').value);
  function updateOperationUI() {
    const update = $('operation').value === 'update';
    $('operation-help').textContent = update
      ? 'Choose your device and release channel. Updates preserve the card format, games, saves, and BIOS files.'
      : 'Choose your device and release channel. A fresh install formats the card and restores the matching stock backup.';
    $('next-device').textContent = update ? 'Continue to SD card' : 'Continue to SD card';
    $('stock').classList.toggle('invisible', update);
    refresh();
  }
  $('operation').onchange = updateOperationUI;
  async function updateReleasePreview() {
    const preRelease = $('release-channel').value === 'prerelease';
    $('release-preview').textContent = 'Checking available releases…';
    try {
      const release = await window.treefrogInstaller.latestRelease(preRelease);
      $('release-preview').innerHTML = `<strong>${release.tag}</strong> · ${release.prerelease ? 'Pre-release / testing' : 'Stable'}<br><span class="text-secondary">This is the TreeFrogUI ZIP that will be installed.</span>`;
    } catch (cause) { $('release-preview').textContent = cause.message || String(cause); }
  }
  $('release-channel').onchange = updateReleasePreview;
  updateReleasePreview();
  $('next-device').onclick = () => showStep('step-2');
  $('back-card').onclick = () => showStep('step-1');
  $('back-install').onclick = () => showStep('step-2');
  $('choose').onclick = async () => {
    const selected = await window.treefrogInstaller.chooseCard(); if (!selected) return;
    $('card').value = selected; inspection = await window.treefrogInstaller.inspectCard(selected);
    $('card-info').textContent = inspection.source ? `${inspection.source} · ${inspection.details || inspection.platform}` : (inspection.hint || 'Could not identify this card. FAT32 formatting is unavailable for it.');
    if (!inspection.formatSupported) { error('This card could not be identified for safe formatting.'); return; }
    updateStatus = null;
    const update = $('operation').value === 'update';
    if (update) {
      try { updateStatus = await window.treefrogInstaller.checkUpdate({ card: selected, preRelease: $('release-channel').value === 'prerelease' }); }
      catch (cause) { error(cause.message || String(cause)); return; }
      $('card-summary').className = `alert small ${updateStatus.legacy ? 'alert-danger' : updateStatus.available ? 'alert-secondary' : 'alert-success'}`;
      if (updateStatus.legacy) $('card-summary').innerHTML = '<strong>This card is running an older TreeFrogUI build.</strong><br>No version marker was found. Install the latest full release first.';
      else if (updateStatus.available) $('card-summary').innerHTML = `<strong>Update available: ${updateStatus.release.tag}</strong><br>Current card version: <code>${updateStatus.current}</code><br>Selected channel: ${updateStatus.release.prerelease ? 'Pre-release / testing' : 'Stable'}`;
      else $('card-summary').innerHTML = `<strong>Already up to date.</strong><br>Card version: <code>${updateStatus.current}</code><br><span class="text-success">There are no newer releases in the selected channel.</span>`;
    } else {
      $('card-summary').className = 'alert alert-secondary small';
      $('card-summary').innerHTML = `<strong>Card to erase</strong><br>Path: <code>${inspection.card}</code><br>Device: <code>${inspection.source}</code><br>Details: ${inspection.details || 'not reported'}<br>Platform: ${inspection.platform}`;
    }
    $('confirm-title').textContent = update ? '3. Confirm update' : '3. Confirm installation';
    $('install-warning').classList.toggle('hidden', update);
    $('install-danger').classList.toggle('hidden', update);
    $('update-note').classList.toggle('hidden', !update);
    $('start').textContent = update ? 'Update TreeFrogUI' : 'Format and install';
    showStep('step-3'); refresh();
  };
  $('start').onclick = async () => {
    if (!inspection?.formatSupported) return;
    const update = $('operation').value === 'update';
    if (update) {
      if (!updateStatus?.available) return;
      busy = true; showStep('step-progress'); error('');
      try {
        const result = await window.treefrogInstaller.update({ deviceId: $('device').value, card: $('card').value, source: inspection.source, preRelease: $('release-channel').value === 'prerelease' });
        $('done-message').textContent = `${result.updated ? `Updated to ${result.release}.` : 'No update was needed.'} ${result.ejected ? 'The SD card was ejected safely.' : 'Please eject the SD card manually.'}`;
        showStep('step-4');
      } catch (cause) { busy = false; showStep('step-3'); error(cause.message || String(cause)); refresh(); }
      return;
    }
    if (!window.confirm(`WARNING: stock SD cards are often low quality and fail. Use a fresh quality card if possible.\n\nIf you are reusing the stock card, back up its files first.\n\nERASE ${inspection.source}\nThis permanently formats the selected SD card as FAT32. Continue?`)) return;
    busy = true; showStep('step-progress'); error('');
    try {
      const result = await window.treefrogInstaller.start({ deviceId: $('device').value, card: $('card').value, source: inspection.source, confirmed: true, preRelease: $('release-channel').value === 'prerelease' });
      $('done-message').textContent = `${result.device} is ready. ${result.ejected ? 'The SD card was ejected safely.' : 'Please eject the SD card manually.'} Installed ${result.release}.`;
      showStep('step-4');
    } catch (cause) { busy = false; showStep('step-3'); error(cause.message || String(cause)); refresh(); }
  };
  window.treefrogInstaller.onProgress(({ message, percent }) => {
    $('progress-title').textContent = message;
    $('progress-message').textContent = `${percent}%`;
    if (message.startsWith('Restoring stock')) { $('stock-progress').style.width = `${Math.min(100, ((percent - 58) / 14) * 100)}%`; $('stock-message').textContent = message; }
    if (message.startsWith('Installing TreeFrogUI') || message.startsWith('Applying')) { $('treefrog-progress').style.width = `${Math.min(100, Math.max(0, ((percent - 76) / 21) * 100))}%`; $('treefrog-message').textContent = message; }
  });
  updateOperationUI();
  showStep('step-1');
}
boot().catch((cause) => error(cause.message || String(cause)));

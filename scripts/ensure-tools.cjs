const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  const root = path.dirname(require.resolve('7zip-bin'));
  for (const platform of ['linux', 'mac']) {
    for (const arch of fs.readdirSync(path.join(root, platform))) {
      const executable = path.join(root, platform, arch, '7za');
      if (fs.existsSync(executable)) fs.chmodSync(executable, 0o755);
    }
  }
}

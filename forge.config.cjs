const path = require('node:path');

module.exports = {
  packagerConfig: { asar: { unpack: '**/node_modules/7zip-bin/**' }, executableName: 'treefrog-installer', icon: path.join(__dirname, 'assets', 'treefrog-icon') },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }]
};

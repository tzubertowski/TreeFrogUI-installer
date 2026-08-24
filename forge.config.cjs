module.exports = {
  packagerConfig: { asar: { unpack: '**/node_modules/7zip-bin/**' }, executableName: 'treefrog-installer' },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }]
};

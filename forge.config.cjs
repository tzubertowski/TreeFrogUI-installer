module.exports = {
  packagerConfig: { asar: true, executableName: 'treefrog-installer' },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux', 'win32'] }]
};

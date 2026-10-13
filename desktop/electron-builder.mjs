export function buildConfig(runtime, output, variant, version) {
  return {
    appId: 'io.github.javierloro.estudio-tfg', productName: 'Estudio TFG',
    directories: { app: runtime, output },
    files: ['**/*', '!**/*.test.mjs'],
    asar: false, npmRebuild: false,
    electronVersion: '44.7.0',
    extraMetadata: { version },
    artifactName: `estudio-tfg-\${version}-\${os}-\${arch}-${variant}.\${ext}`,
    publish: [{ provider: 'generic', url: 'https://github.com/JavierLoro/estudio-tfg/releases/latest/download/', channel: variant }],
    mac: { target: ['dmg', 'zip'], category: 'public.app-category.productivity', identity: null,
      minimumSystemVersion: process.arch === 'arm64' ? '26.0' : '13.0' },
    win: { target: ['nsis', 'portable'], verifyUpdateCodeSignature: false },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
    portable: { artifactName: `estudio-tfg-\${version}-win-\${arch}-${variant}-portable.exe` },
    linux: { target: ['AppImage'], category: 'Office', executableName: 'estudio-tfg' },
  };
}

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function signMacBundle(context) {
  // electron-builder can cross-package Windows targets from macOS. Only sign
  // an actual macOS app bundle, never a Windows unpacked directory.
  if (context.electronPlatformName !== 'darwin') return;
  const entry = fs.readdirSync(context.appOutDir, { withFileTypes: true })
    .find((item) => item.isDirectory() && item.name.endsWith('.app'));
  if (!entry) throw new Error('找不到待打包的 macOS 应用。');
  const appPath = path.join(context.appOutDir, entry.name);
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  if (signed.error || signed.status !== 0) throw signed.error || new Error('macOS 临时签名失败。');
  const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
  if (verified.error || verified.status !== 0) throw verified.error || new Error('macOS 应用签名校验失败。');
};

import fs from 'node:fs';
import path from 'node:path';
export function prepareDataDir(env = process.env, cwd = process.cwd()) {
  const dir = path.resolve(env.RAILWAY_VOLUME_MOUNT_PATH || env.DATA_DIR || (env.RAILWAY_ENVIRONMENT_ID ? '/data' : path.join(cwd, 'data')));
  fs.mkdirSync(dir, { recursive: true });
  const legacy = path.resolve(cwd, 'data');
  if (legacy !== dir && fs.existsSync(legacy)) {
    for (const name of ['settings.json', 'rolepanels.json', 'voiceguard.json']) {
      const from = path.join(legacy, name), to = path.join(dir, name);
      if (!fs.existsSync(to) && fs.existsSync(from)) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
  }
  if (env.RAILWAY_ENVIRONMENT_ID && !env.RAILWAY_VOLUME_MOUNT_PATH) console.warn('[DATA] Attach a Railway Volume at /data. DATA_DIR alone does not persist data.');
  console.log('[DATA] ' + dir);
  return dir;
}

import fs from 'node:fs/promises';
import path from 'node:path';

export const AVATAR_DIR = process.env.AVATAR_DIR || path.resolve('data/avatars');

export async function ensureAvatarDir() {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
}

export async function removeAvatarFile(avatarUrl) {
  if (!avatarUrl || !avatarUrl.startsWith('/api/avatars/')) return;
  const filename = path.basename(avatarUrl);
  if (!/^[a-f0-9-]+\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) return;
  await fs.unlink(path.join(AVATAR_DIR, filename)).catch(() => {});
}

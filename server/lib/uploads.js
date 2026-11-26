import fs from 'node:fs';
import path from 'node:path';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('data/uploads');

export function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

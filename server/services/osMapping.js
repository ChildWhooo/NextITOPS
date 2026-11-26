import { getSetting } from '../lib/systemSettings.js';

export const DEFAULT_OS_RULES = [
  { pattern: 'el6', name: 'Redhat6' },
  { pattern: 'el7', name: 'CentOS7' },
  { pattern: 'el8', name: 'CentOS8' },
  { pattern: 'el9', name: 'RockyLinux8' },
];

export async function getOsRules() {
  try {
    const raw = JSON.parse(await getSetting('zabbix_os_mappings', '[]'));
    if (Array.isArray(raw) && raw.length) return raw.filter((rule) => rule?.pattern && rule?.name);
  } catch {}
  return DEFAULT_OS_RULES;
}

export function mapOperatingSystem(rawValue, rules = DEFAULT_OS_RULES) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { name: '', kernel: '', raw: '' };
  const lower = raw.toLowerCase();
  for (const rule of rules) {
    if (lower.includes(String(rule.pattern).toLowerCase())) return { name: rule.name, kernel: kernelFrom(raw), raw };
  }
  const windows = raw.match(/Windows(?: Server)? \d{4}(?: R2)?(?: (?:Standard|Enterprise|Datacenter|Essentials))?/i);
  if (windows) return { name: windows[0].replace(/\s+/g, ' ').trim(), kernel: kernelFrom(raw), raw };
  const windowsClient = raw.match(/Windows \d+(?:\.\d+)* (?:Enterprise|Professional|Pro|Home|Education|IoT)/i);
  if (windowsClient) return { name: windowsClient[0].replace(/\s+/g, ' ').trim(), kernel: kernelFrom(raw), raw };
  return { name: raw.split(/\s+\(/)[0].slice(0, 120), kernel: kernelFrom(raw), raw };
}

export function kernelFrom(rawValue) {
  const raw = String(rawValue || '').trim();
  const linux = raw.match(/Linux version\s+([^\s]+)/i);
  if (linux) return linux[1];
  const windowsBuild = raw.match(/Build\s+([\d.]+)/i);
  if (windowsBuild) return windowsBuild[1];
  const windowsVersion = raw.match(/Windows(?: Server)?\s+\S+\s+([\d]+\.[\d.]+)/i);
  if (windowsVersion) return windowsVersion[1];
  return '';
}

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0.20261126';
const CHANNEL = (import.meta.env.VITE_APP_CHANNEL || 'beta').toLowerCase();
export const IS_BETA = !['production', 'stable'].includes(CHANNEL) && /beta/i.test(APP_VERSION);

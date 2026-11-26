export const DATA_CHANGED_EVENT = 'nextitops:data-changed';

export function notifyDataChanged() {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

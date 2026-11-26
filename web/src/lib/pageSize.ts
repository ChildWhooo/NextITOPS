import { useEffect, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100, 150, 200];

export function usePageSize(key: string, fallback = 10) {
  const storageKey = `nextitops_page_size_${key}`;
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : fallback;
  });
  useEffect(() => {
    localStorage.setItem(storageKey, String(pageSize));
  }, [pageSize, storageKey]);
  return [pageSize, setPageSize] as const;
}

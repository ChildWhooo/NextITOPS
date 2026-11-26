import { useEffect, useState } from 'react';
import { useBranding } from '@/context/BrandingContext';

export function useDebounce<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function usePageTitle(title: string) {
  const { branding } = useBranding();
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · ${branding.system_name || 'NextITOps'}`;
    return () => {
      document.title = previous;
    };
  }, [title, branding.system_name]);
}

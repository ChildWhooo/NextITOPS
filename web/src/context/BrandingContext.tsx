import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

export interface Branding {
  system_name: string;
  system_logo: string;
  system_description?: string;
  system_subtitle?: string;
  login_headline?: string;
  login_background?: string;
  login_copyright?: string;
  login_status_text?: string;
  default_sidebar_theme?: string;
  login_gradient?: string;
  nav_labels?: Record<string, string>;
  version?: string;
}

const DEFAULT_BRANDING: Branding = {
  system_name: 'NextITOps',
  system_logo: '/logo.svg',
  system_description: '让配置、告警与服务流程在一个清晰的工作台里协同运转。',
  system_subtitle: 'SERVICE INTELLIGENCE',
  login_headline: '让每一次变更，都有据可依。',
  login_background: '',
  login_copyright: '',
  login_status_text: '',
  default_sidebar_theme: 'ink',
  login_gradient: 'aurora',
  nav_labels: {},
};

interface BrandingContextValue {
  branding: Branding;
  refresh: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextValue>({ branding: DEFAULT_BRANDING, refresh: async () => {} });

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  const refresh = async () => {
    try {
      const response = await api.get<{ data: Branding }>('/api/system/branding');
      setBranding({ ...DEFAULT_BRANDING, ...response.data });
    } catch {
      setBranding(DEFAULT_BRANDING);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const href = branding.system_logo || '/logo.svg';
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = href;
  }, [branding.system_logo]);

  return <BrandingContext.Provider value={{ branding, refresh }}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_EVO_BACKEND_URL?: string;
  readonly VITE_EVO_VERSION?: string;
  readonly VITE_EVO_VERSION_CODE?: string;
  readonly VITE_EVO_PLATFORM?: string;
  readonly VITE_SUPPORT_CONTACT_URL?: string;
  readonly VITE_COMMERCIAL_CONTACT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

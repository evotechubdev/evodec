function value(input: string | undefined, fallback = ''): string {
  const normalized = input?.trim();
  return normalized ? normalized : fallback;
}

export const appConfig = Object.freeze({
  backendUrl: value(
    import.meta.env.VITE_EVO_BACKEND_URL,
    '/pwa-api',
  ).replace(/\/+$/, ''),
  firebaseApiKey: value(
    import.meta.env.VITE_FIREBASE_API_KEY,
    'AIzaSyDbSMFXN6pmkqfhtBm3no2bXoAbyT_FoAo',
  ),
  // A PWA usa um canal web próprio e não participa do versionamento obrigatório
  // dos aplicativos Android e Windows.
  clientPlatform: 'web',
  loginDomain: 'evotv.com.br',
});

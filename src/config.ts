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
  clientVersion: value(import.meta.env.VITE_EVO_VERSION, '1.0.6'),
  clientVersionCode: value(
    import.meta.env.VITE_EVO_VERSION_CODE,
    'bde12f9159868653eea9eb54f9150bc44e66e84909fa84ede26833be0a2f63b5',
  ),
  // Compatibilidade temporária: o backend atual só possui canais android e pc.
  // Assim que o canal web existir, defina VITE_EVO_PLATFORM=web no build.
  clientPlatform: value(import.meta.env.VITE_EVO_PLATFORM, 'android'),
  loginDomain: 'evoiptv.com.br',
});

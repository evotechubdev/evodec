export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    const insidePwa = /\/pwa(?:\/|$)/.test(window.location.pathname);
    const legacyScope = new URL(insidePwa ? '../' : './', window.location.href).pathname;
    const pwaScope = new URL(insidePwa ? './' : 'pwa/', window.location.href).pathname;

    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(
        registrations
          .filter((registration) => new URL(registration.scope).pathname === legacyScope)
          .map((registration) => registration.unregister()),
      );

      if (!insidePwa) return;
      const workerUrl = `${import.meta.env.BASE_URL}../sw.js`;
      await navigator.serviceWorker.register(workerUrl, { scope: pwaScope });
    }).catch(() => {
      // A aplicação continua utilizável mesmo sem o cache offline.
    });
  });
}

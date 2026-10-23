export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    const insidePwa = /\/pwa\/?$/.test(window.location.pathname);
    const workerUrl = `${import.meta.env.BASE_URL}${insidePwa ? '../' : ''}sw.js`;
    const scope = new URL(insidePwa ? '../' : './', window.location.href).pathname;
    void navigator.serviceWorker
      .register(workerUrl, { scope })
      .catch(() => {
        // A aplicação continua utilizável mesmo sem o cache offline.
      });
  });
}

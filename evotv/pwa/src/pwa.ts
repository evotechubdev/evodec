const SERVICE_WORKER_VERSION = '17';
const ACTIVATION_TIMEOUT_MS = 15_000;
const RELOAD_MARKER = `evotv-sw-reload-v${SERVICE_WORKER_VERSION}`;

let setupPromise: Promise<ServiceWorker> | null = null;

export async function registerDirectMediaTarget(target: string, fileName: string): Promise<string> {
  if (!('serviceWorker' in navigator)) throw new Error('O navegador nao oferece o componente de midia local.');
  const worker = await (setupPromise ??= prepareServiceWorker());
  const id = crypto.randomUUID();
  const channel = new MessageChannel();
  const response = new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('O componente de midia nao respondeu.')), 5_000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean; error?: string }>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data || {});
    };
  });
  worker.postMessage({ type: 'EVOTV_DIRECT_MEDIA_REGISTER', id, target }, [channel.port2]);
  const result = await response;
  if (!result.ok) throw new Error(result.error || 'Nao foi possivel preparar a midia local.');
  const safeName = fileName.replace(/[^a-z0-9._-]/gi, '').slice(0, 80) || 'media.mp4';
  return new URL(`__direct_media/${id}/${safeName}`, window.location.href).href;
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  if (!/\/pwa(?:\/|$)/.test(window.location.pathname)) return;
  setupPromise ??= prepareServiceWorker();
  void setupPromise.catch(() => {
    // Login e catálogo continuam disponíveis mesmo se o modo offline falhar.
  });
}

async function prepareServiceWorker(): Promise<ServiceWorker> {
  const legacyScope = new URL('../', window.location.href).pathname;
  const pwaScope = new URL('./', window.location.href).pathname;
  const workerUrl = new URL(`${import.meta.env.BASE_URL}../sw.js?v=${SERVICE_WORKER_VERSION}`, window.location.href).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter((registration) => new URL(registration.scope).pathname === legacyScope)
      .map((registration) => registration.unregister()),
  );

  const registration = await navigator.serviceWorker.register(workerUrl, {
    scope: pwaScope,
    updateViaCache: 'none',
  });
  await registration.update();
  await waitForActive(registration);

  const controller = await waitForCompatibleController();
  if (controller) {
    sessionStorage.removeItem(RELOAD_MARKER);
    return controller;
  }

  if (sessionStorage.getItem(RELOAD_MARKER) !== '1') {
    sessionStorage.setItem(RELOAD_MARKER, '1');
    window.location.reload();
    return new Promise<ServiceWorker>(() => {});
  }
  throw new Error('O navegador não ativou o componente seguro. Limpe os dados deste site e abra o PWA novamente.');
}

async function waitForActive(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active) return;
  const worker = registration.installing || registration.waiting;
  if (!worker) {
    await navigator.serviceWorker.ready;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('A atualização segura demorou mais que o esperado.')), ACTIVATION_TIMEOUT_MS);
    const changed = () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timeout);
        worker.removeEventListener('statechange', changed);
        resolve();
      } else if (worker.state === 'redundant') {
        window.clearTimeout(timeout);
        worker.removeEventListener('statechange', changed);
        reject(new Error('O navegador recusou a atualização do componente seguro.'));
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  });
}

async function waitForCompatibleController(): Promise<ServiceWorker | null> {
  const current = navigator.serviceWorker.controller;
  if (current && await ping(current)) return current;
  return new Promise<ServiceWorker | null>((resolve) => {
    let settled = false;
    const finish = (worker: ServiceWorker | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      resolve(worker);
    };
    const changed = () => {
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;
      void ping(controller).then((compatible) => {
        if (compatible) finish(controller);
      });
    };
    const timeout = window.setTimeout(() => finish(null), ACTIVATION_TIMEOUT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    changed();
  });
}

async function ping(worker: ServiceWorker): Promise<boolean> {
  const channel = new MessageChannel();
  return new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 1_500);
    channel.port1.onmessage = (event: MessageEvent<{ version?: string }>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data?.version === SERVICE_WORKER_VERSION);
    };
    worker.postMessage({ type: 'EVOTV_PING' }, [channel.port2]);
  });
}

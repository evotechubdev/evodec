import type { SecurePlaybackSource } from './api';

const RELAY_ORIGIN = 'https://evotv-web-media-relay.bonnystork8.chatgpt.site';
const REGISTER_TIMEOUT_MS = 8_000;

interface RegisteredMediaSource {
  id: string;
  url: string;
}

export async function registerSecureMedia(
  source: SecurePlaybackSource,
): Promise<RegisteredMediaSource> {
  const relayUrl = new URL(source.url);
  if (relayUrl.origin !== RELAY_ORIGIN || !relayUrl.pathname.startsWith('/stream/')) {
    throw new Error('O servidor retornou uma origem de mídia não autorizada.');
  }
  if (!('serviceWorker' in navigator)) {
    throw new Error('Este navegador não oferece o modo seguro necessário para reproduzir esta mídia.');
  }

  await navigator.serviceWorker.ready;
  const controller = await activeController();
  const id = randomId();
  const channel = new MessageChannel();

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('O modo seguro ainda está sendo atualizado. Feche e abra o PWA e tente novamente.'));
    }, REGISTER_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean; error?: string }>) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else reject(new Error(event.data?.error || 'Não foi possível proteger o endereço da mídia.'));
    };
    controller.postMessage(
      { type: 'EVOTV_MEDIA_REGISTER', id, url: relayUrl.href, headers: source.headers },
      [channel.port2],
    );
  });

  return {
    id,
    url: new URL(`__media/${id}`, pwaBaseUrl()).href,
  };
}

export function unregisterSecureMedia(id: string): void {
  navigator.serviceWorker?.controller?.postMessage({ type: 'EVOTV_MEDIA_REMOVE', id });
}

async function activeController(): Promise<ServiceWorker> {
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  return new Promise<ServiceWorker>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      reject(new Error('Atualize ou reabra o PWA para ativar a reprodução segura.'));
    }, REGISTER_TIMEOUT_MS);
    function changed() {
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      resolve(controller);
    }
    navigator.serviceWorker.addEventListener('controllerchange', changed);
  });
}

function pwaBaseUrl(): URL {
  const path = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : window.location.pathname.replace(/[^/]*$/, '');
  return new URL(path, window.location.origin);
}

function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

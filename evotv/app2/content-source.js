// Origem exclusiva dos catálogos de Canais, Filmes e Séries do app2.
// Preencha somente quando o serviço dedicado estiver publicado no Render.
export const CONTENT_BACKEND_URL = '';

export const CONTENT_PRODUCTION_MESSAGE = 'Conteúdo em Produção.';

export const ANONMP4_HOSTING = Object.freeze({
  provider: 'anonmp4.to',
  publicOrigin: 'https://anonmp4.to',
  apiOrigin: 'https://anonmp4api.xyz',
});

export function contentBackendUrl() {
  const value = String(CONTENT_BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value)) {
    throw new Error('Conteúdo em Produção.');
  }
  return value;
}

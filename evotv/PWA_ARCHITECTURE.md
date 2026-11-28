# Arquitetura do PWA EVOTV

## Decisão

O PWA usa o mesmo backend de negócio do programa para PC e do Android:

- backend oficial: `multimideas-evo-backend`;
- frontend PWA: `evotv/app`;
- relay de saída: Worker `evotv-media-relay`, versionado em `evoiptv-backend/cloudflare-worker`.

O antigo `app-backend` deixa de ser uma API paralela do PWA. Seus snapshots e catálogos offline não são mais fonte de conteúdo. O código do Worker permanece aproveitado porque a rede Cloudflare consegue alcançar o servidor IPTV que recusa conexões originadas no Render.

## Fluxos

### Catálogo e detalhes

1. O PWA autentica no Firebase e seleciona um perfil no backend oficial.
2. O PWA chama somente rotas autenticadas do backend oficial, como `/api/catalog` e `/api/tv`.
3. O backend usa `DADOS_CONTA` e consulta a API Xtream exatamente pelo fluxo que já atende PC e Android.
4. O backend aplica catálogo, perfil, controle parental e ocultação de URLs antes de responder ao PWA.

O Worker não participa desse fluxo. Assim, o catálogo compartilhado e o comportamento das aplicações nativas não mudam.

### Canais, filmes e episódios IPTV

1. O PWA pede `/api/stream-ticket` com `transport: "edge"`.
2. O backend valida sessão, perfil, catálogo e controle parental e devolve um ticket opaco.
3. O PWA troca apenas a origem autorizada pela origem fixa do Worker e abre `/open-stream/...`.
4. O Worker apresenta `X-Evo-Edge-Secret` ao backend.
5. Somente após validar o segredo, o backend informa o destino ao Worker.
6. O Worker transmite a mídia por HTTPS e preserva `Range` sem expor servidor, usuário ou senha ao navegador.

### Conteúdo extra

O catálogo e os episódios vêm das rotas autenticadas do backend oficial. O backend emite tickets `/extra-stream/...`; playlists privadas não entram no catálogo nem no bundle do PWA.

## Segredos e proibições

- `DADOS_CONTA` e `DADOS_CONTA_KEY` permanecem somente no backend oficial.
- O Worker não guarda uma segunda conta IPTV: servidor, usuário e senha continuam vindo exclusivamente do `DADOS_CONTA` do backend e só existem de forma efêmera na requisição de saída já autorizada.
- `TICKET_SECRET` permanece como secret do Worker.
- `EDGE_PROVIDER_RELAY_SECRET` no Render deve ter exatamente o mesmo valor de `TICKET_SECRET` no Worker.
- Tickets e URLs completas de reprodução não podem ser gravados no console, analytics, cache ou logs do frontend.
- O ticket `edge` não abre diretamente no backend sem o segredo do Worker.
- O backend só emite `transport: "edge"` para sessões da plataforma `web`; PC e Android mantêm seus transportes atuais.
- O Worker aceita somente rotas opacas de mídia, valida o host IPTV por allowlist e não funciona como proxy de URL arbitrária.
- Ao consultar o IPTV, o Worker não encaminha `Origin` nem `Referer` do navegador, repetindo a fronteira de origem usada no relay do DramaFren.

## Configuração de produção

Worker:

- `AUTH_BACKEND_ORIGIN=https://multimideas-evo-backend.onrender.com`
- `TICKET_SECRET=<segredo compartilhado>`
- `OFFLINE_MEDIA_HOSTS=<hosts IPTV estritamente necessários>`
- `ALLOWED_APP_ORIGINS=<origens oficiais e localhost de desenvolvimento>`

Render:

- `EDGE_PROVIDER_RELAY_SECRET=<mesmo TICKET_SECRET do Worker>`

## Ordem de publicação

1. Configurar o mesmo segredo no Worker e no Render.
2. Publicar primeiro o backend oficial, pois a nova rota `edge` é aditiva e não altera PC/Android.
3. Publicar o Worker com `AUTH_BACKEND_ORIGIN` apontando para o backend oficial.
4. Publicar imediatamente o PWA e validar canais, filmes, séries e extras em navegador real.

Não publique o PWA antes das duas camadas de servidor: ele falhará fechado com `EDGE_RELAY_UNAVAILABLE`, sem recorrer a credenciais no cliente.

# EVOTV Cloudflare Media Proxy

Worker para retransmitir por HTTPS uma midia HTTP autorizada pelo backend.
O navegador envia somente caminhos temporarios `/open-stream/...` e
`/segment/...`. O backend valida a conta e emite uma abertura de uso unico; o
Worker segue essa abertura internamente e entrega os bytes por HTTPS, sem passar
o arquivo de video pelo Render.

## Configuracao

1. Mantenha `AUTH_BACKEND_ORIGIN` apontando para o backend HTTPS.
2. Liste em `ALLOWED_APP_ORIGINS` as origens exatas do PWA, separadas por virgula.
3. Crie o segredo `MEDIA_TOKEN_KEY` com pelo menos 32 caracteres. Ele criptografa
   internamente os enderecos de playlists, chaves e segmentos HLS.
4. Execute `npm install`, `npm test` e `npm run deploy`.
5. Defina a URL HTTPS publicada em `VITE_EVO_EDGE_PROXY_URL` no build do PWA.

Para desenvolvimento local, use `npm run dev` e configure no PWA:

```text
VITE_EVO_EDGE_PROXY_URL=http://localhost:8787
```

O endereco HTTP local so e aceito pelo PWA em desenvolvimento. Em producao, o
Worker sempre precisa usar HTTPS.

## Seguranca e limites

- aceita apenas `GET`, `HEAD` e `OPTIONS`;
- restringe a origem do PWA e aceita somente tickets opacos e de uso unico;
- nunca devolve o redirecionamento do provedor ao navegador;
- criptografa os destinos HLS usando `MEDIA_TOKEN_KEY`;
- mantem endereco, porta e credenciais fora do codigo e das respostas do PWA;
- preserva `Range`/`If-Range` e transmite o corpo como stream;
- nao usa cache para tickets ou midia.

O consumo da midia conta nos limites e custos da Cloudflare. O backend autoriza
a abertura, mas nao retransmite mais o arquivo completo.

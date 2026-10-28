# EVOTV Cloudflare Media Proxy — teste

Worker opcional para retransmitir por HTTPS uma mídia autorizada pelo backend.
O navegador envia somente os caminhos temporários `/stream/...` e `/segment/...`.
O Worker nunca recebe o domínio, a porta, o usuário ou a senha do provedor IPTV:
somente o backend abre a conexão com ele.

## Configuração

1. Em `wrangler.jsonc`, mantenha `AUTH_BACKEND_ORIGIN` apontando para o backend.
2. Em `ALLOWED_APP_ORIGINS`, liste as origens exatas do PWA, separadas por vírgula.
3. Execute `npm install`, `npm test` e `npm run deploy`.
4. Copie a URL HTTPS publicada e defina `VITE_EVO_EDGE_PROXY_URL` no build do PWA.

Para desenvolvimento local, use `npm run dev` e configure no PWA:

```text
VITE_EVO_EDGE_PROXY_URL=http://localhost:8787
```

O endereço HTTP local só é aceito pelo PWA durante o modo de desenvolvimento.
Em produção, o endereço do Worker precisa usar HTTPS.

## Segurança e limites

- aceita apenas `GET`, `HEAD` e `OPTIONS`;
- restringe a origem do PWA e aceita somente tickets opacos do backend;
- faz requisições apenas ao backend HTTPS configurado;
- mantém endereço, porta e credenciais do provedor exclusivamente no backend;
- preserva `Range`/`If-Range` e transmite o corpo como stream, sem carregar o
  vídeo inteiro na memória;
- não usa cache para tickets ou mídia.

O consumo de mídia conta nos limites e custos da conta Cloudflare e do backend.

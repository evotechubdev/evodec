# EVOTV PWA

Cliente web instalável do EVOTV, construído com React, TypeScript e Vite. Usa o
mesmo Firebase e o mesmo backend no Render dos aplicativos Android e PC.

## Recursos

- login Firebase pela API REST;
- contas, perfis, catálogo, filmes, séries e episódios;
- autorização de reprodução com RSA-OAEP e AES-GCM usando Web Crypto;
- manifesto e service worker para instalação na tela inicial;
- interface responsiva para celulares, computadores e Smart TVs;
- navegação por teclado, setas e controles remotos que enviam teclas direcionais;
- senha mantida apenas na memória da página; somente o login pode ser lembrado.

## Desenvolvimento

Copie `.env.example` para `.env`, preencha as variáveis e execute:

```sh
npm install
npm run dev
```

Para validar e gerar os arquivos estáticos:

```sh
npm run build
```

O resultado fica em `dist/`: `dist/index.html` é o portal de suporte e
`dist/pwa/index.html` é a área privada instalável, iniciada pela tela de
login. Ambos devem ser servidos por HTTPS. O service worker não é registrado
durante `npm run dev`.

O arquivo `render.yaml` publica `dist/`, mantém o portal na raiz, redireciona
`/pwa` para `/pwa/`, entrega o aplicativo por `/pwa/*` e encaminha
`/pwa-api/*` ao backend atual.

## Variáveis

- `VITE_FIREBASE_API_KEY`: Web API Key do Firebase.
- `VITE_EVO_BACKEND_URL`: padrão `/pwa-api`, no mesmo domínio público.
- `VITE_EVO_EDGE_PROXY_URL`: opcional; URL HTTPS do Cloudflare Worker em
  `cloudflare-worker/`. Vazio mantém a abertura direta atual.

A PWA usa o canal fixo `web` e não possui versão obrigatória. Os campos de
versão do Firebase são exclusivos dos aplicativos Android e Windows.

## GitHub Actions e Pages

O workflow `.github/workflows/pages.yml` valida, compila e publica os sites no
GitHub Pages a cada push na branch `main`. O site principal do EVODEC fica em:

```text
https://evotechubdev.github.io/evodec/index.html
```

O portal do EVOTV e o aplicativo PWA ficam, respectivamente, em:

```text
https://evotechubdev.github.io/evodec/evotv/index.html
https://evotechubdev.github.io/evodec/evotv/pwa/index.html
```

## Backend

O código do backend não está neste repositório. O encaminhamento `/pwa-api/*`
mantém as chamadas do navegador no mesmo domínio e envia a requisição ao backend
`https://multimideas-evo-backend.onrender.com`. Se esse encaminhamento não for
usado, o backend precisará permitir por CORS o domínio público e os cabeçalhos
`Authorization`, `Content-Type`, `x-evo-platform`, `x-evo-version`,
`x-evo-version-code`, `x-evo-session` e `x-evo-profile`.

O backend aceita o canal `web` sem consultar `config/versao`. As respostas de
`/api/account`, `/api/profile`, `/api/catalog`, `/api/tv` e `/api/session`
continuam protegidas por autenticação e sessão. Sem o proxy opcional, a mídia
deve ser fornecida por HTTPS, pois páginas HTTPS não podem reproduzir streams
HTTP.

O teste `?direct_http=1` para Chrome no Windows solicita ao backend o transporte
`resolved`. O navegador recebe somente a URL temporária final do provedor; o PWA
não solicita, descriptografa nem armazena as credenciais IPTV. Esse modo continua
dependendo da permissão explícita de conteúdo inseguro do navegador.

## Teste com Cloudflare Workers

O diretório `cloudflare-worker/` contém um proxy de borda opcional. Quando
`VITE_EVO_EDGE_PROXY_URL` está definido, o PWA solicita ao backend um ticket
protegido de `/stream/...` e troca somente a origem pela URL HTTPS do Worker.
O Worker fala exclusivamente com o backend; somente o backend conhece e acessa
o domínio, a porta e as credenciais do provedor IPTV. Playlists HLS mantêm seus
segmentos sob o mesmo proxy sem revelar o destino original.

Antes de publicar, edite `cloudflare-worker/wrangler.jsonc` e inclua em
`ALLOWED_APP_ORIGINS` cada origem pública usada pelo PWA. Não configure domínio,
usuário ou senha do IPTV na Cloudflare. Depois execute:

```sh
cd cloudflare-worker
npm install
npm test
npm run deploy
```

Defina a URL retornada pelo Wrangler em `VITE_EVO_EDGE_PROXY_URL` e gere um novo
build do PWA. O endpoint `/health` do Worker informa `configured: true` quando a
configuração mínima foi aplicada. O tráfego de vídeo consome a cota da conta
Cloudflare e a transferência do backend.

## Android, Smart TVs e outros sistemas

No Android e no Android TV, o aplicativo Android nativo continua sendo a opção
principal. A PWA é uma alternativa para aparelhos onde o APK não pode ser
instalado. O botão **Guia de Instalação**, na tela de login, mostra o passo a
passo para Chrome no Android, Chrome no computador e Safari no iPhone ou iPad.
A instalação formal em Smart TVs depende do navegador e do sistema do fabricante.

A interface aceita teclado e as setas de controles remotos que o navegador
expõe como `ArrowUp`, `ArrowDown`, `ArrowLeft` e `ArrowRight`. A reprodução ainda
depende dos formatos de vídeo suportados pelo navegador de cada TV.

## Link no site principal

O cartão **EVOTV - PWA** deve apontar diretamente para:

```text
https://evotechubdev.github.io/evodec/evotv/pwa/index.html
```

O parâmetro `?install=1`, usado pelo cartão do site de suporte, abre diretamente
o guia na tela de login. O guia não dispara compartilhamento nem instalação:
ele apresenta apenas as instruções e um **X** para fechar.

No site principal, mantenha sempre as três opções visíveis, nesta ordem e com
estes textos:

1. **EVOTV - Android (versão: 1.0.7)**
2. **EVOTV - PC Windows (versão: 0.3)**
3. **EVOTV - PWA**

O Android continua sendo a primeira tentativa do representante comercial. A
PWA permanece disponível como alternativa universal, inclusive no Android e em
Smart TVs. A identificação do dispositivo deve apenas orientar o clique na PWA;
ela não deve esconder nem reordenar as três opções. Os cartões Android e Windows
devem manter os links de distribuição já usados pelos respectivos projetos.

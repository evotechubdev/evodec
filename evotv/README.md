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
`dist/pwa/index.html` é o aplicativo instalável. Ambos devem ser servidos por
HTTPS. O service worker não é registrado durante `npm run dev`.

O arquivo `render.yaml` publica `dist/`, mantém o portal na raiz, redireciona
`/pwa` para `/pwa/`, entrega o aplicativo por `/pwa/*` e encaminha
`/pwa-api/*` ao backend atual.

## Variáveis

- `VITE_FIREBASE_API_KEY`: Web API Key do Firebase.
- `VITE_EVO_BACKEND_URL`: padrão `/pwa-api`, no mesmo domínio público.
- `VITE_EVO_VERSION`: versão exibida ao backend.
- `VITE_EVO_VERSION_CODE`: código aceito pelo controle de versões do backend.
- `VITE_EVO_PLATFORM`: use `android` para compatibilidade temporária; troque para
  `web` depois de cadastrar o canal web no backend.

## GitHub Actions e Pages

O workflow `.github/workflows/pages.yml` valida, compila e publica o PWA no
GitHub Pages a cada push na branch `main`. A publicação fica disponível em:

```text
https://evotechubdev.github.io/multimideas-evo-pwa/
```

O portal de suporte ocupa esse endereço. O aplicativo PWA fica em:

```text
https://evotechubdev.github.io/multimideas-evo-pwa/pwa/
```

## Ajustes aditivos no backend

O código do backend não está neste repositório. O encaminhamento `/pwa-api/*`
mantém as chamadas do navegador no mesmo domínio e envia a requisição ao backend
`https://multimideas-evo-backend.onrender.com`. Se esse encaminhamento não for
usado, o backend precisará permitir por CORS o domínio público e os cabeçalhos
`Authorization`, `Content-Type`, `x-evo-platform`, `x-evo-version`,
`x-evo-version-code`, `x-evo-session` e `x-evo-profile`.

Antes de criar um canal próprio para a PWA, o serviço deve:

1. cadastrar um canal de versão `web` sem remover ou alterar `android` e `pc`;
2. manter as respostas atuais de `/api/account`, `/api/profile`, `/api/catalog`,
   `/api/iptv` e `/api/session`;
3. fornecer mídia por HTTPS. Páginas HTTPS não podem reproduzir streams HTTP.

Enquanto o canal `web` não existir, o build usa `android` somente como modo de
compatibilidade com o contrato atual. Isso não modifica o aplicativo Android.

## Android, Smart TVs e outros sistemas

No Android e no Android TV, o aplicativo Android nativo continua sendo a opção
principal. A PWA é uma alternativa para aparelhos onde o APK não pode ser
instalado. Em navegadores compatíveis, o botão **Instalar** abre a confirmação
do próprio sistema; nos demais, o EVOTV funciona pelo endereço web e pode ser
salvo como favorito. A instalação formal em Smart TVs depende do navegador e do
sistema do fabricante.

A interface aceita teclado e as setas de controles remotos que o navegador
expõe como `ArrowUp`, `ArrowDown`, `ArrowLeft` e `ArrowRight`. A reprodução ainda
depende dos formatos de vídeo suportados pelo navegador de cada TV.

## Link no site principal

O cartão **EVOTV - PWA (versão: 1.0.6)** deve apontar diretamente para:

```text
https://www.evotv.com.br/pwa/
```

Na primeira visita de cada sessão, a própria página abre o assistente de
instalação. Navegadores compatíveis oferecem a confirmação nativa quando
disponível. Nenhum navegador permite concluir a instalação sem uma ação
explícita do usuário. O parâmetro opcional
`?install=1` força a reabertura do assistente e `?install=0` o ignora.

No site principal, mantenha sempre as três opções visíveis, nesta ordem e com
estes textos:

1. **EVOTV - Android (versão: 1.0.6)**
2. **EVOTV - PC Windows (versão: 0.2)**
3. **EVOTV - PWA (versão: 1.0.6)**

O Android continua sendo a primeira tentativa do representante comercial. A
PWA permanece disponível como alternativa universal, inclusive no Android e em
Smart TVs. A identificação do dispositivo deve apenas orientar o clique na PWA;
ela não deve esconder nem reordenar as três opções. Os cartões Android e Windows
devem manter os links de distribuição já usados pelos respectivos projetos.

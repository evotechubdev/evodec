# EVOTV DramaFren Relay

Worker dedicado ao piloto de importacao de uma mininovela pelo painel web.
Ele nao acessa Firebase, nao recebe credenciais EVOTV e nao e um proxy aberto.

## Fluxo

1. O painel pede os metadados de um `bookId` publico.
2. O painel pede uma fonte por episodio; o Worker consulta o DramaFren sem
   encaminhar o cabecalho `Origin` do navegador.
3. Somente depois de montar a serie completa, o painel autenticado envia o
   objeto ao backend administrativo existente.

## Rotas

- `GET /health`
- `GET /v1/metadata?id=<bookId de 24 caracteres hexadecimais>`
- `GET /v1/playback?id=<bookId>&episode=<1..1000>`

Todas as rotas de dados aceitam somente origens listadas em
`ALLOWED_PANEL_ORIGINS`. Os destinos externos sao fixos no codigo e as URLs de
playlist devolvidas precisam pertencer ao CDN oficial ja aceito pelo catalogo.

## Desenvolvimento e publicacao

```text
npm install
npm test
npm run deploy
```

O nome configurado publica o endereco esperado pelo painel:

```text
https://evotv-dramafren-relay.evotechubdev.workers.dev
```

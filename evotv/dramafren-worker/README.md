# EVOTV DramaFren Relay

Worker dedicado ao fluxo oficial de importacao de mininovelas pelo painel web.
Ele nao acessa Firebase, nao recebe credenciais EVOTV e nao e um proxy aberto.

## Fluxo

1. O painel organiza lotes de 1 a 20 links e pede os metadados de cada
   `bookId` publico.
2. O painel pede uma fonte por episodio; o Worker consulta o DramaFren sem
   encaminhar o cabecalho `Origin` do navegador.
3. Somente depois de montar cada serie completa, o painel autenticado envia o
   objeto ao backend administrativo existente e ao Firebase.

O mesmo fluxo e usado no painel publicado e no acesso local. Nenhum complemento
de navegador ou conector Windows e necessario.

## Rotas

- `GET /health`
- `GET /v1/metadata?id=<bookId de 24 caracteres hexadecimais>`
- `GET /v1/playback?id=<bookId>&episode=<1..1000>`

Todas as rotas de dados aceitam somente origens listadas em
`ALLOWED_PANEL_ORIGINS`. Os destinos externos sao fixos no codigo e as URLs de
playlist devolvidas precisam pertencer ao CDN oficial ja aceito pelo catalogo.
Para espelhar o painel publicado durante o desenvolvimento, `localhost` e
`127.0.0.1` sao aceitos via HTTP em qualquer porta.

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

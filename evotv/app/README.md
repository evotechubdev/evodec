# EVOTV App Offline

Aplicação pública independente que consulta somente o snapshot incorporado em
`data/catalogo-offline.json`. Não há login IPTV, sincronização ou área
administrativa neste projeto.

## Reprodução

O navegador nunca abre o destino HTTP diretamente. Ao selecionar um filme:

1. o app envia o URL final sem credenciais ao backend por HTTPS;
2. o backend valida origem, host e caminho e emite um ticket criptografado;
3. o app entrega ao `<video>` apenas a URL HTTPS temporária do Cloudflare Worker;
4. o Worker troca o ticket com o backend e transmite a mídia final por HTTPS.

Backend dedicado:

```text
https://multimideas-evo-backend-app.onrender.com
```

O catálogo público carrega 45 itens por lote conforme a rolagem da grade. A
interface e o catálogo continuam disponíveis offline; a reprodução exige rede.

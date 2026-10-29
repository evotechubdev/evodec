# EVOTV App Offline

Aplicação pública independente que consulta o snapshot incorporado em
`data/catalogo-offline.json`. O APP usa o mesmo Firebase e o mesmo backend de
contas do Programa de PC para login, perfis, sessões e controle parental. Não
há sincronização nem área administrativa neste projeto.

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

O catálogo carrega 45 itens por lote conforme a rolagem da grade. A interface
e o catálogo continuam disponíveis offline; login e reprodução exigem rede.

Por enquanto somente Filmes possui catálogo. Canais, Séries, Shows e Conteúdo
Extra já aparecem na estrutura de navegação e serão ativados quando seus dados
forem incorporados.

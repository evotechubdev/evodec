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

## Acesso lembrado neste aparelho

A senha digitada não é armazenada. Quando o usuário escolhe manter o acesso,
o APP guarda somente o token renovável do Firebase em um cofre local no
IndexedDB, criptografado com AES-256-GCM e uma chave não exportável criada pelo
Web Crypto do dispositivo. O PIN de perfil pode ser guardado no mesmo cofre.
Sair da conta ou desmarcar a opção de manter o acesso apaga a sessão e os PINs
salvos naquele navegador.

Uma política de segurança de conteúdo bloqueia imagens e mídia HTTP no front-end.
Capas HTTP usam a imagem padrão; os filmes chegam ao player somente pela URL
HTTPS temporária do Cloudflare Worker.

O catálogo segue a organização do Programa de PC. A seção inicial é
`Filmes | Lançamentos 2026`, ordenada pelo campo `added` do mais recente para o
mais antigo, seguida por Recém Adicionados, Favoritos, Todos e pelas categorias
do snapshot. Favoritos são locais por conta e perfil. Contas PREMIUM recebem um
ícone de download nos cards; o backend devolve a mídia HTTPS como anexo.

O modal possui sinopse e trailer incorporado. O APP usa apenas sinopses e IDs ou
URLs reais presentes no snapshot, sem transformar uma pesquisa em trailer. O
snapshot atual ainda não contém esses campos, por isso esses dados aparecerão
quando forem incluídos pela futura rotina administrativa de enriquecimento.

Por enquanto somente Filmes possui catálogo. Canais, Séries, Shows e Conteúdo
Extra já aparecem na estrutura de navegação e serão ativados quando seus dados
forem incorporados.

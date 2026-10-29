# EVOTV Catálogo Offline

PWA estático e independente do EVOTV principal.

- `index.html`: catálogo e reprodução; não solicita credenciais.
- `admin.html`: sincronização manual, importação, exportação e backups.
- `data/catalogo-get-completo.json`: resposta completa e bruta de `get_vod_streams`.
- `data/catalogo-offline.json`: catálogo enriquecido com `url_padrao` e `url_final`.

O catálogo incorporado contém URLs diretas e deve permanecer privado até que seja definida a política de publicação. A administração usa as credenciais apenas em memória e nunca as salva. Antes de importar, restaurar ou sincronizar, o catálogo atual é preservado no IndexedDB; no máximo cinco backups são mantidos.

Em páginas HTTPS, navegadores podem bloquear a consulta ou reprodução HTTP como conteúdo misto. O funcionamento offline refere-se aos metadados do catálogo e ao shell do aplicativo; a reprodução continua exigindo acesso à origem de mídia.

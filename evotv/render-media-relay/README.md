# EVOTV Render Media Relay

Serviço isolado que recebe um ticket curto do backend EVOTV, resolve o endereço
do provedor sem expô-lo ao PWA e transmite a mídia por HTTPS.

Ele não armazena credenciais do IPTV, não acessa o Firebase e não substitui o
backend usado pelo programa de PC ou pelo aplicativo Android.

## Publicação no Render

1. Crie um **Blueprint** usando o repositório `evotechubdev/evodec`.
2. Informe `evotv/render-media-relay/render.yaml` como caminho do Blueprint.
3. Confirme o plano gratuito e a região `Virginia`.
4. Depois da publicação, valide `https://<servico>.onrender.com/health`.

A região precisa ser diferente da região do backend principal. Os endereços de
saída do Render são compartilhados entre serviços da mesma região; um segundo
serviço na mesma região não seria um teste de rede diferente.

## Variáveis

- `ALLOWED_ORIGIN`: origem exata autorizada a usar o relay.
- `AUTH_BACKEND_ORIGIN`: origem do backend que emite os tickets assinados.
- `PORT`: fornecida automaticamente pelo Render.

Nenhuma credencial do provedor deve ser adicionada a este serviço.

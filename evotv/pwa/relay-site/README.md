# EVOTV Web Media Relay

Relay HTTPS exclusivo do PWA. Ele recebe do backend uma origem IPTV criptografada, valida o ticket e a sessão no backend principal e transmite o corpo HTTP como HTTPS para Chrome e Safari.

- A chave privada fica somente no ambiente hospedado.
- URLs e credenciais do provedor não aparecem no código ou na resposta da API.
- O relay aceita somente autorizações vinculadas a tickets emitidos pelo backend.
- PC e Android não utilizam este serviço.

Validação local:

```text
npm test
npm run build
npm run validate
```

O artefato publicado fica em `dist/` e é gerado por `scripts/build.mjs`.

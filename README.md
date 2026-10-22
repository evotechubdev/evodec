# EVOTV para iOS

Base Flutter do aplicativo EVOTV. O projeto nativo `ios/` e gerado durante a
primeira compilacao no Codemagic, permitindo iniciar o desenvolvimento no
Windows sem manter arquivos gerados manualmente.

## Codemagic

- Project path: `.`
- Branch: `main`
- Project type: `Flutter`
- Workflow: `EVOTV iOS - compilacao sem assinatura`

O fluxo inicial apenas valida e compila o aplicativo sem assinatura Apple.
Publicacao no TestFlight ou na App Store sera configurada separadamente quando
existirem as credenciais do Apple Developer Program.

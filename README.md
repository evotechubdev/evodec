# EVOTV para iOS

Base Flutter do aplicativo EVOTV. A primeira etapa da migracao inclui a tela de
login, autenticacao Firebase por API, consulta da conta no backend, armazenamento
seguro das credenciais e selecao visual de perfis.

O projeto nativo `ios/` e gerado durante a compilacao no Codemagic, permitindo
iniciar o desenvolvimento no Windows sem manter arquivos gerados manualmente.

## Codemagic

- Project path: `.`
- Branch: `main`
- Project type: `Flutter`
- Workflow: `EVOTV iOS - compilacao sem assinatura`

O fluxo inicial apenas valida e compila o aplicativo sem assinatura Apple.
Publicacao no TestFlight ou na App Store sera configurada separadamente quando
existirem as credenciais do Apple Developer Program.

## Variaveis de ambiente

Para autenticar de verdade, configure como variaveis secretas no Codemagic:

- `FIREBASE_API_KEY`: chave Web API do projeto Firebase.
- `EVO_VERSION_CODE`: codigo de versao aceito pelo backend.
- `EVO_PLATFORM`: temporariamente `android`, ate o backend ganhar um canal `ios`.

abstract final class AppConfig {
  static const backendUrl = String.fromEnvironment(
    'EVO_BACKEND_URL',
    defaultValue: 'https://multimideas-evo-backend.onrender.com',
  );

  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const clientVersion = String.fromEnvironment(
    'EVO_VERSION',
    defaultValue: '1.0.6',
  );
  static const clientVersionCode = String.fromEnvironment('EVO_VERSION_CODE');

  // O backend atual ainda possui apenas os canais android e pc. O canal pode
  // ser trocado para ios por --dart-define assim que ele for criado no servidor.
  static const clientPlatform = String.fromEnvironment(
    'EVO_PLATFORM',
    defaultValue: 'android',
  );

  static const loginDomain = 'evoiptv.com.br';
}

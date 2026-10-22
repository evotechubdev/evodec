import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models.dart';

abstract interface class EvoApiClient {
  Future<AuthSession> signIn(String login, String password);

  Future<Account> account(String token);

  void close();
}

class EvoApi implements EvoApiClient {
  EvoApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  @override
  Future<AuthSession> signIn(String rawLogin, String password) async {
    final login = rawLogin.trim().toLowerCase();
    if (!RegExp(r'^[a-z0-9._-]{1,64}$').hasMatch(login)) {
      throw const EvoApiException('Login inválido.');
    }
    if (AppConfig.firebaseApiKey.isEmpty) {
      throw const EvoApiException(
        'A chave do Firebase ainda não foi configurada no Codemagic.',
      );
    }

    final uri = Uri.https(
      'identitytoolkit.googleapis.com',
      '/v1/accounts:signInWithPassword',
      <String, String>{'key': AppConfig.firebaseApiKey},
    );
    final response = await _client
        .post(
          uri,
          headers: const {'Content-Type': 'application/json'},
          body: jsonEncode(<String, Object>{
            'email': '$login@${AppConfig.loginDomain}',
            'password': password,
            'returnSecureToken': true,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final data = _objectResponse(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final code = _firebaseError(data);
      if (const {
        'INVALID_LOGIN_CREDENTIALS',
        'EMAIL_NOT_FOUND',
        'INVALID_PASSWORD',
      }.contains(code)) {
        throw const EvoApiException('Login ou senha inválidos.');
      }
      throw EvoApiException(
        code.isEmpty ? 'Não foi possível entrar no Firebase.' : code,
      );
    }

    final idToken = data['idToken']?.toString() ?? '';
    if (idToken.isEmpty) {
      throw const EvoApiException('O Firebase não retornou o token de acesso.');
    }
    final expiresIn = int.tryParse(data['expiresIn']?.toString() ?? '') ?? 3600;
    return AuthSession(
      idToken: idToken,
      refreshToken: data['refreshToken']?.toString() ?? '',
      expiresAt: DateTime.now().add(Duration(seconds: expiresIn - 60)),
    );
  }

  @override
  Future<Account> account(String token) async {
    if (AppConfig.clientVersionCode.isEmpty) {
      throw const EvoApiException(
        'O código de versão do EVOTV ainda não foi configurado no Codemagic.',
      );
    }
    final response = await _client
        .get(
          Uri.parse('${AppConfig.backendUrl}/api/account'),
          headers: _backendHeaders(token),
        )
        .timeout(const Duration(seconds: 30));
    final data = _objectResponse(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EvoApiException(_backendError(data, response.statusCode));
    }

    final rawNames = data['profileNames'];
    final names = rawNames is List
        ? rawNames.map((value) => value.toString()).toList(growable: false)
        : const <String>[];
    final rawScreens = data['screens'];
    final screens = (rawScreens is num
            ? rawScreens.toInt().clamp(1, 20)
            : int.tryParse(rawScreens?.toString() ?? '')?.clamp(1, 20) ?? 1)
        .toInt();
    return Account(
      screens: screens,
      profileNames: names,
      accountType: (data['accountType']?.toString() ?? 'STANDARD').toUpperCase(),
    );
  }

  Map<String, String> _backendHeaders(String token) => <String, String>{
    'Accept': 'application/json',
    'Authorization': 'Bearer $token',
    'x-evo-platform': AppConfig.clientPlatform,
    'x-evo-version': AppConfig.clientVersion,
    'x-evo-version-code': AppConfig.clientVersionCode,
  };

  Map<String, dynamic> _objectResponse(http.Response response) {
    if (response.body.trim().isEmpty) return <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
    } on FormatException {
      throw const EvoApiException('O serviço retornou uma resposta inválida.');
    }
  }

  String _firebaseError(Map<String, dynamic> data) {
    final error = data['error'];
    if (error is Map<String, dynamic>) return error['message']?.toString() ?? '';
    return error?.toString() ?? '';
  }

  String _backendError(Map<String, dynamic> data, int status) {
    final error = data['error'];
    if (error is String && error.trim().isNotEmpty) return error;
    if (error is Map<String, dynamic>) {
      final message = error['message']?.toString() ?? '';
      if (message.trim().isNotEmpty) return message;
    }
    final message = data['message']?.toString() ?? '';
    return message.trim().isNotEmpty
        ? message
        : 'O serviço respondeu com o código $status.';
  }

  @override
  void close() => _client.close();
}

class EvoApiException implements Exception {
  const EvoApiException(this.message);

  final String message;

  @override
  String toString() => message;
}

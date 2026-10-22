import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models.dart';

abstract interface class CredentialsStore {
  Future<SavedCredentials?> load();

  Future<void> save(String login, String password);

  Future<void> clear();
}

class SecureCredentialsStore implements CredentialsStore {
  SecureCredentialsStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _credentialsKey = 'evo_credentials_v1';
  final FlutterSecureStorage _storage;

  @override
  Future<SavedCredentials?> load() async {
    try {
      final raw = await _storage.read(key: _credentialsKey);
      if (raw == null || raw.isEmpty) return null;
      final data = jsonDecode(raw);
      if (data is! Map<String, dynamic>) return null;
      final login = data['login']?.toString() ?? '';
      final password = data['password']?.toString() ?? '';
      if (login.isEmpty || password.isEmpty) return null;
      return SavedCredentials(login: login, password: password);
    } on Object {
      await clear();
      return null;
    }
  }

  @override
  Future<void> save(String login, String password) => _storage.write(
    key: _credentialsKey,
    value: jsonEncode(<String, String>{'login': login, 'password': password}),
  );

  @override
  Future<void> clear() => _storage.delete(key: _credentialsKey);
}

class MemoryCredentialsStore implements CredentialsStore {
  SavedCredentials? value;

  @override
  Future<void> clear() async => value = null;

  @override
  Future<SavedCredentials?> load() async => value;

  @override
  Future<void> save(String login, String password) async {
    value = SavedCredentials(login: login, password: password);
  }
}

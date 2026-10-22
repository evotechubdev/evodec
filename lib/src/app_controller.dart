import 'package:flutter/foundation.dart';

import 'models.dart';
import 'services/credentials_store.dart';
import 'services/evo_api.dart';

enum AppScreen { login, profiles }

class AppController extends ChangeNotifier {
  AppController({required EvoApiClient api, required CredentialsStore credentials})
    : _api = api,
      _credentials = credentials;

  final EvoApiClient _api;
  final CredentialsStore _credentials;

  AppScreen screen = AppScreen.login;
  String loginValue = '';
  String passwordValue = '';
  bool remember = false;
  bool loading = false;
  String error = '';
  String notice = '';
  Account? account;

  Future<void> initialize() async {
    final saved = await _credentials.load();
    if (saved != null) {
      loginValue = saved.login;
      passwordValue = saved.password;
      remember = true;
      notifyListeners();
    }
  }

  void editLogin(String value) {
    loginValue = value;
    error = '';
    notifyListeners();
  }

  void editPassword(String value) {
    passwordValue = value;
    error = '';
    notifyListeners();
  }

  Future<void> setRemember(bool value) async {
    remember = value;
    if (!value) await _credentials.clear();
    notifyListeners();
  }

  Future<void> signIn() async {
    if (loading) return;
    if (loginValue.trim().isEmpty || passwordValue.isEmpty) {
      error = 'Informe login e senha para continuar.';
      notifyListeners();
      return;
    }

    loading = true;
    error = '';
    notice = '';
    notifyListeners();
    try {
      final auth = await _api.signIn(loginValue, passwordValue);
      final loadedAccount = await _api.account(auth.idToken);
      if (remember) {
        await _credentials.save(loginValue.trim().toLowerCase(), passwordValue);
      } else {
        await _credentials.clear();
      }
      account = loadedAccount;
      passwordValue = '';
      screen = AppScreen.profiles;
    } on Object catch (exception) {
      error = _readable(exception);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void selectProfile(int profile) {
    notice = 'Perfil $profile selecionado. O catálogo será conectado na próxima etapa.';
    error = '';
    notifyListeners();
  }

  void logout() {
    account = null;
    screen = AppScreen.login;
    notice = '';
    error = '';
    if (!remember) loginValue = '';
    notifyListeners();
  }

  String _readable(Object error) {
    if (error is EvoApiException) return error.message;
    if (error is Exception) {
      final value = error.toString().replaceFirst('Exception: ', '').trim();
      if (value.isNotEmpty) return value;
    }
    return 'Não foi possível concluir a operação.';
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }
}

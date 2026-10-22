import 'package:flutter/foundation.dart';

import 'models.dart';
import 'services/credentials_store.dart';
import 'services/evo_api.dart';

enum AppScreen { login, profiles, catalog }

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
  AuthSession? authSession;
  ProfileSession? profileSession;
  int selectedProfile = 0;
  MediaKind selectedKind = MediaKind.live;
  List<CatalogItem> catalog = const <CatalogItem>[];

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
      authSession = auth;
      passwordValue = '';
      screen = AppScreen.profiles;
    } on Object catch (exception) {
      error = _readable(exception);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> selectProfile(int profile) async {
    final auth = authSession;
    if (loading || auth == null) return;
    loading = true;
    error = '';
    notice = '';
    notifyListeners();
    try {
      final session = await _api.selectProfile(auth.idToken, profile);
      profileSession = session;
      selectedProfile = profile;
      final page = await _api.catalog(
        auth.idToken,
        session.sessionToken,
        profile,
        MediaKind.live,
      );
      selectedKind = MediaKind.live;
      catalog = page.items;
      screen = AppScreen.catalog;
    } on Object catch (exception) {
      await _releaseSession();
      selectedProfile = 0;
      error = _readable(exception);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> changeKind(MediaKind kind) async {
    final auth = authSession;
    final session = profileSession;
    if (loading || auth == null || session == null || kind == selectedKind) {
      return;
    }
    selectedKind = kind;
    loading = true;
    error = '';
    catalog = const <CatalogItem>[];
    notifyListeners();
    try {
      final page = await _api.catalog(
        auth.idToken,
        session.sessionToken,
        selectedProfile,
        kind,
      );
      catalog = page.items;
    } on Object catch (exception) {
      error = _readable(exception);
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> backToProfiles() async {
    await _releaseSession();
    catalog = const <CatalogItem>[];
    selectedProfile = 0;
    screen = AppScreen.profiles;
    error = '';
    notifyListeners();
  }

  Uri playbackSource(CatalogItem item) {
    final grant = profileSession?.playbackGrant;
    if (grant == null) throw StateError('A sessão de reprodução não está ativa.');
    return grant.source(item);
  }

  Future<SeriesDetails> loadSeries(CatalogItem series) async {
    final auth = authSession;
    final session = profileSession;
    if (auth == null || session == null || selectedProfile < 1) {
      throw StateError('A sessão do perfil terminou. Abra o perfil novamente.');
    }
    return _api.seriesDetails(
      auth.idToken,
      session.sessionToken,
      selectedProfile,
      series,
    );
  }

  Future<void> logout() async {
    await _releaseSession();
    account = null;
    authSession = null;
    catalog = const <CatalogItem>[];
    selectedProfile = 0;
    screen = AppScreen.login;
    notice = '';
    error = '';
    if (!remember) loginValue = '';
    notifyListeners();
  }

  Future<void> _releaseSession() async {
    final auth = authSession;
    final session = profileSession;
    final profile = selectedProfile;
    profileSession = null;
    if (auth != null && session != null && profile > 0) {
      await _api.releaseProfile(auth.idToken, session.sessionToken, profile);
    }
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

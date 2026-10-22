import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models.dart';
import 'playback_crypto.dart';

abstract interface class EvoApiClient {
  Future<AuthSession> signIn(String login, String password);

  Future<Account> account(String token);

  Future<ProfileSession> selectProfile(String token, int profile);

  Future<CatalogPage> catalog(
    String token,
    String sessionToken,
    int profile,
    MediaKind kind,
  );

  Future<SeriesDetails> seriesDetails(
    String token,
    String sessionToken,
    int profile,
    CatalogItem series,
  );

  Future<void> releaseProfile(
    String token,
    String sessionToken,
    int profile,
  );

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

  @override
  Future<ProfileSession> selectProfile(String token, int profile) async {
    final keys = await PlaybackKeys.generate();
    final response = await _client
        .post(
          Uri.parse('${AppConfig.backendUrl}/api/profile'),
          headers: _backendHeaders(token),
          body: jsonEncode(<String, Object>{
            'profile': profile,
            'force': true,
            'pin': '',
            'playbackPublicKey': keys.publicKey,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final data = _objectResponse(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EvoApiException(_backendError(data, response.statusCode));
    }
    final sessionToken = data['sessionToken']?.toString() ?? '';
    final rawGrant = data['playbackGrant'];
    if (sessionToken.isEmpty || rawGrant is! Map<String, dynamic>) {
      throw const EvoApiException(
        'O servidor não enviou uma sessão de reprodução válida.',
      );
    }
    try {
      final grant = await keys.decrypt(rawGrant, profile);
      return ProfileSession(sessionToken: sessionToken, playbackGrant: grant);
    } on Object catch (_) {
      throw const EvoApiException(
        'Não foi possível validar a autorização de reprodução.',
      );
    }
  }

  @override
  Future<CatalogPage> catalog(
    String token,
    String sessionToken,
    int profile,
    MediaKind kind,
  ) async {
    final response = await _client
        .post(
          Uri.parse('${AppConfig.backendUrl}/api/catalog'),
          headers: _backendHeaders(
            token,
            sessionToken: sessionToken,
            profile: profile,
          ),
          body: jsonEncode(<String, Object>{
            'section': kind.section,
            'category': 'all',
            'page': 1,
            'limit': 48,
            'query': '',
            'adult': false,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final data = _objectResponse(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EvoApiException(_backendError(data, response.statusCode));
    }
    final rawItems = data['items'];
    final items = rawItems is List
        ? rawItems
              .whereType<Map>()
              .map(
                (raw) => _catalogItem(
                  raw.map((key, value) => MapEntry(key.toString(), value)),
                  kind,
                ),
              )
              .whereType<CatalogItem>()
              .toList(growable: false)
        : const <CatalogItem>[];
    return CatalogPage(
      items: items,
      page: _asInt(data['page'], fallback: 1),
      total: _asInt(data['total'], fallback: items.length),
      hasMore: data['hasMore'] == true,
    );
  }

  @override
  Future<SeriesDetails> seriesDetails(
    String token,
    String sessionToken,
    int profile,
    CatalogItem series,
  ) async {
    final response = await _client
        .post(
          Uri.parse('${AppConfig.backendUrl}/api/iptv'),
          headers: _backendHeaders(
            token,
            sessionToken: sessionToken,
            profile: profile,
          ),
          body: jsonEncode(<String, Object>{
            'action': 'get_series_info',
            'extra': <String, String>{'series_id': series.id},
            'adult': false,
          }),
        )
        .timeout(const Duration(seconds: 30));
    final data = _objectResponse(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EvoApiException(_backendError(data, response.statusCode));
    }
    final info = _stringMap(data['info']);
    final rawEpisodes = data['episodes'];
    final seasons = <SeriesSeason>[];
    if (rawEpisodes is Map) {
      for (final entry in rawEpisodes.entries) {
        final seasonNumber = int.tryParse(entry.key.toString()) ?? 0;
        final rawSeason = entry.value;
        if (rawSeason is! List) continue;
        final episodes = <SeriesEpisode>[];
        for (var index = 0; index < rawSeason.length; index++) {
          final episode = _stringMap(rawSeason[index]);
          final episodeInfo = _stringMap(episode['info']);
          final id = episode['id']?.toString() ?? '';
          if (id.isEmpty) continue;
          final number = _asInt(
            episode['episode_num'] ?? episodeInfo['episode_num'],
            fallback: index + 1,
          );
          final title = _firstText(<Object?>[
            episode['title'],
            episodeInfo['name'],
            'Episódio $number',
          ]);
          episodes.add(
            SeriesEpisode(
              id: id,
              number: number,
              title: title,
              duration: _firstText(<Object?>[
                episodeInfo['duration'],
                episodeInfo['duration_secs'],
              ]),
              extension: _firstText(<Object?>[
                episode['container_extension'],
                'mp4',
              ]),
            ),
          );
        }
        if (episodes.isNotEmpty) {
          episodes.sort((a, b) => a.number.compareTo(b.number));
          seasons.add(SeriesSeason(number: seasonNumber, episodes: episodes));
        }
      }
    }
    seasons.sort((a, b) => a.number.compareTo(b.number));
    return SeriesDetails(
      title: _firstText(<Object?>[info['name'], series.name]),
      plot: _firstText(<Object?>[info['plot'], info['description']]),
      coverUrl: _firstText(<Object?>[
        info['cover'],
        info['movie_image'],
        series.imageUrl,
      ]),
      seasons: seasons,
    );
  }

  @override
  Future<void> releaseProfile(
    String token,
    String sessionToken,
    int profile,
  ) async {
    try {
      await _client
          .delete(
            Uri.parse('${AppConfig.backendUrl}/api/session'),
            headers: _backendHeaders(
              token,
              sessionToken: sessionToken,
              profile: profile,
            ),
          )
          .timeout(const Duration(seconds: 10));
    } on Object {
      // Encerrar uma sessão é uma limpeza de melhor esforço.
    }
  }

  Map<String, String> _backendHeaders(
    String token, {
    String? sessionToken,
    int? profile,
  }) => <String, String>{
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': 'Bearer $token',
    'x-evo-platform': AppConfig.clientPlatform,
    'x-evo-version': AppConfig.clientVersion,
    'x-evo-version-code': AppConfig.clientVersionCode,
    if (sessionToken != null) 'x-evo-session': sessionToken,
    if (profile != null) 'x-evo-profile': '$profile',
  };

  CatalogItem? _catalogItem(
    Map<String, dynamic> data,
    MediaKind kind,
  ) {
    final idKey = kind == MediaKind.series ? 'series_id' : 'stream_id';
    final id = data[idKey]?.toString() ?? '';
    if (id.isEmpty) return null;
    final imageKey = kind == MediaKind.series ? 'cover' : 'stream_icon';
    return CatalogItem(
      id: id,
      name: data['name']?.toString().trim().isNotEmpty == true
          ? data['name'].toString()
          : 'Sem título',
      categoryId: data['category_id']?.toString() ?? '',
      extension:
          data['container_extension']?.toString().trim().isNotEmpty == true
          ? data['container_extension'].toString()
          : kind == MediaKind.live
          ? 'ts'
          : 'mp4',
      imageUrl: data[imageKey]?.toString() ?? '',
      kind: kind,
    );
  }

  int _asInt(Object? value, {required int fallback}) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? fallback;
  }

  Map<String, dynamic> _stringMap(Object? value) {
    if (value is! Map) return <String, dynamic>{};
    return value.map((key, item) => MapEntry(key.toString(), item));
  }

  String _firstText(List<Object?> values) {
    for (final value in values) {
      final text = value?.toString().trim() ?? '';
      if (text.isNotEmpty) return text;
    }
    return '';
  }

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

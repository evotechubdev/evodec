import 'package:evoiptv/src/app.dart';
import 'package:evoiptv/src/app_controller.dart';
import 'package:evoiptv/src/models.dart';
import 'package:evoiptv/src/services/credentials_store.dart';
import 'package:evoiptv/src/services/evo_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

class FakeEvoApi implements EvoApiClient {
  @override
  Future<Account> account(String token) async => const Account(
    screens: 2,
    profileNames: <String>['Thiago', 'Convidado'],
    accountType: 'PREMIUM',
  );

  @override
  Future<AuthSession> signIn(String login, String password) async => AuthSession(
    idToken: 'token',
    refreshToken: 'refresh',
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
  );

  @override
  Future<ProfileSession> selectProfile(String token, int profile) async =>
      ProfileSession(
        sessionToken: 'session',
        playbackGrant: PlaybackGrant(
          server: 'https://example.com',
          username: 'user',
          password: 'password',
          profile: profile,
          expiresAt: DateTime.now().add(const Duration(hours: 1)),
        ),
      );

  @override
  Future<CatalogPage> catalog(
    String token,
    String sessionToken,
    int profile,
    MediaKind kind,
  ) async => CatalogPage(
    items: <CatalogItem>[
      CatalogItem(
        id: '1',
        name: kind == MediaKind.live ? 'TV Bahia' : 'Conteúdo de teste',
        categoryId: '1',
        extension: 'ts',
        imageUrl: '',
        kind: kind,
      ),
    ],
    page: 1,
    total: 1,
    hasMore: false,
  );

  @override
  Future<SeriesDetails> seriesDetails(
    String token,
    String sessionToken,
    int profile,
    CatalogItem series,
  ) async => SeriesDetails(
    title: series.name,
    plot: 'Série de teste',
    coverUrl: '',
    seasons: const <SeriesSeason>[
      SeriesSeason(
        number: 1,
        episodes: <SeriesEpisode>[
          SeriesEpisode(
            id: '101',
            number: 1,
            title: 'Episódio 1',
            duration: '45:00',
            extension: 'mp4',
          ),
        ],
      ),
    ],
  );

  @override
  Future<void> releaseProfile(
    String token,
    String sessionToken,
    int profile,
  ) async {}

  @override
  void close() {}
}

void main() {
  testWidgets('faz login e mostra os perfis da conta', (tester) async {
    final controller = AppController(
      api: FakeEvoApi(),
      credentials: MemoryCredentialsStore(),
    );
    await controller.initialize();

    await tester.pumpWidget(EvoIptvApp(controller: controller));
    expect(find.text('ENTRAR'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('login-field')), 'thiago');
    await tester.enterText(find.byKey(const ValueKey('password-field')), 'senha');
    await tester.tap(find.byKey(const ValueKey('sign-in-button')));
    await tester.pumpAndSettle();

    expect(find.text('Quem está assistindo?'), findsOneWidget);
    expect(find.text('Thiago'), findsOneWidget);
    expect(find.text('Convidado'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('profile-1')));
    await tester.pumpAndSettle();

    expect(find.text('Canais'), findsOneWidget);
    expect(find.text('TV Bahia'), findsOneWidget);
  });
}

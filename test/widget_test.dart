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
  });
}

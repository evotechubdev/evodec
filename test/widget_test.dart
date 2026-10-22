import 'package:evoiptv/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('exibe a tela inicial do EVOTV', (tester) async {
    await tester.pumpWidget(const EvoIptvApp());

    expect(find.text('EVOTV'), findsOneWidget);
    expect(find.text('Base do aplicativo iOS configurada.'), findsOneWidget);
  });
}

import 'package:flutter/material.dart';

import 'src/app.dart';
import 'src/app_controller.dart';
import 'src/services/credentials_store.dart';
import 'src/services/evo_api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final controller = AppController(
    api: EvoApi(),
    credentials: SecureCredentialsStore(),
  );
  await controller.initialize();

  runApp(EvoIptvApp(controller: controller));
}

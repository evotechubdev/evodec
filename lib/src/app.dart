import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'models.dart';

const _background = Color(0xFF07080A);
const _surface = Color(0xFF15181E);
const _surfaceLight = Color(0xFF202630);
const _accent = Color(0xFF25D8FF);
const _accentBlue = Color(0xFF006DFF);
const _textPrimary = Color(0xFFF4F5F7);
const _textMuted = Color(0xFF9299A5);
const _error = Color(0xFFFF7A67);

class EvoIptvApp extends StatefulWidget {
  const EvoIptvApp({required this.controller, super.key});

  final AppController controller;

  @override
  State<EvoIptvApp> createState() => _EvoIptvAppState();
}

class _EvoIptvAppState extends State<EvoIptvApp> {
  @override
  void dispose() {
    widget.controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EVOTV',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: _background,
        colorScheme: ColorScheme.fromSeed(
          seedColor: _accentBlue,
          brightness: Brightness.dark,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: _surfaceLight,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide.none,
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _accent, width: 2),
          ),
        ),
      ),
      home: AnimatedBuilder(
        animation: widget.controller,
        builder: (context, _) => switch (widget.controller.screen) {
          AppScreen.login => LoginScreen(controller: widget.controller),
          AppScreen.profiles => ProfilesScreen(controller: widget.controller),
          AppScreen.catalog => CatalogScreen(controller: widget.controller),
        },
      ),
    );
  }
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({required this.controller, super.key});

  final AppController controller;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  late final TextEditingController _login;
  late final TextEditingController _password;
  bool _hidePassword = true;

  @override
  void initState() {
    super.initState();
    _login = TextEditingController(text: widget.controller.loginValue);
    _password = TextEditingController(text: widget.controller.passwordValue);
  }

  @override
  void dispose() {
    _login.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: _surface,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: Colors.white.withValues(alpha: .08)),
                  boxShadow: const [
                    BoxShadow(color: Color(0x66006DFF), blurRadius: 48),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(26, 30, 26, 26),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Image.asset(
                        'assets/images/logo_evotv.png',
                        height: 92,
                        fit: BoxFit.contain,
                      ),
                      const SizedBox(height: 22),
                      const Text(
                        'ENTRAR',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: _accent,
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 2.5,
                        ),
                      ),
                      const SizedBox(height: 22),
                      TextField(
                        key: const ValueKey('login-field'),
                        controller: _login,
                        enabled: !controller.loading,
                        autocorrect: false,
                        textInputAction: TextInputAction.next,
                        onChanged: controller.editLogin,
                        decoration: const InputDecoration(
                          labelText: 'Login',
                          prefixIcon: Icon(Icons.person_outline),
                        ),
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        key: const ValueKey('password-field'),
                        controller: _password,
                        enabled: !controller.loading,
                        obscureText: _hidePassword,
                        autocorrect: false,
                        enableSuggestions: false,
                        textInputAction: TextInputAction.done,
                        onChanged: controller.editPassword,
                        onSubmitted: (_) => controller.signIn(),
                        decoration: InputDecoration(
                          labelText: 'Senha',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            onPressed: () => setState(
                              () => _hidePassword = !_hidePassword,
                            ),
                            icon: Icon(
                              _hidePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Material(
                        type: MaterialType.transparency,
                        child: SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          value: controller.remember,
                          onChanged: controller.loading
                              ? null
                              : controller.setRemember,
                          title: const Text(
                            'Lembrar login e senha',
                            style: TextStyle(color: _textMuted, fontSize: 14),
                          ),
                        ),
                      ),
                      if (controller.error.isNotEmpty) ...[
                        Text(
                          controller.error,
                          key: const ValueKey('error-message'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: _error),
                        ),
                        const SizedBox(height: 12),
                      ],
                      FilledButton(
                        key: const ValueKey('sign-in-button'),
                        onPressed: controller.loading ? null : controller.signIn,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(54),
                          backgroundColor: _accentBlue,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: controller.loading
                            ? const SizedBox.square(
                                dimension: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : const Text(
                                'CONTINUAR',
                                style: TextStyle(
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 1.4,
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ProfilesScreen extends StatelessWidget {
  const ProfilesScreen({required this.controller, super.key});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final account = controller.account;
    final screens = account?.screens ?? 1;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Image.asset(
          'assets/images/logo_evotv.png',
          height: 42,
          fit: BoxFit.contain,
        ),
        actions: [
          TextButton.icon(
            onPressed: controller.logout,
            icon: const Icon(Icons.logout),
            label: const Text('Sair'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Quem está assistindo?',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: _textPrimary,
                  fontSize: 27,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                account?.accountType ?? 'STANDARD',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _accent,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.5,
                ),
              ),
              if (controller.notice.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  controller.notice,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF68E39A)),
                ),
              ],
              if (controller.error.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  controller.error,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _error),
                ),
              ],
              if (controller.loading) ...[
                const SizedBox(height: 14),
                const Center(child: CircularProgressIndicator()),
              ],
              const SizedBox(height: 24),
              Expanded(
                child: GridView.builder(
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 220,
                    mainAxisExtent: 176,
                    crossAxisSpacing: 16,
                    mainAxisSpacing: 16,
                  ),
                  itemCount: screens,
                  itemBuilder: (context, index) {
                    final profile = index + 1;
                    return InkWell(
                      key: ValueKey('profile-$profile'),
                      onTap: controller.loading
                          ? null
                          : () => controller.selectProfile(profile),
                      borderRadius: BorderRadius.circular(20),
                      child: Ink(
                        decoration: BoxDecoration(
                          color: _surface,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: .09),
                          ),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            CircleAvatar(
                              radius: 40,
                              backgroundColor: _accentBlue,
                              child: Text(
                                '$profile',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 30,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              account?.profileName(index) ?? 'Perfil $profile',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _textPrimary,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class CatalogScreen extends StatelessWidget {
  const CatalogScreen({required this.controller, super.key});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final profileIndex = controller.selectedProfile - 1;
    final profileName = controller.account?.profileName(profileIndex) ??
        'Perfil ${controller.selectedProfile}';
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        leading: IconButton(
          tooltip: 'Trocar perfil',
          onPressed: controller.loading ? null : controller.backToProfiles,
          icon: const Icon(Icons.arrow_back),
        ),
        title: Image.asset(
          'assets/images/logo_evotv.png',
          height: 40,
          fit: BoxFit.contain,
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Center(
              child: Text(
                profileName,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _textMuted,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Row(
                children: MediaKind.values
                    .map(
                      (kind) => Padding(
                        padding: const EdgeInsets.only(right: 10),
                        child: ChoiceChip(
                          label: Text(kind.label),
                          selected: controller.selectedKind == kind,
                          onSelected: controller.loading
                              ? null
                              : (_) => controller.changeKind(kind),
                        ),
                      ),
                    )
                    .toList(growable: false),
              ),
            ),
            if (controller.error.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
                child: Text(
                  controller.error,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _error),
                ),
              ),
            Expanded(child: _catalogBody(context)),
          ],
        ),
      ),
    );
  }

  Widget _catalogBody(BuildContext context) {
    if (controller.loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (controller.catalog.isEmpty) {
      return Center(
        child: Text(
          'Nenhum conteúdo encontrado em ${controller.selectedKind.label}.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: _textMuted),
        ),
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 190,
        childAspectRatio: .67,
        crossAxisSpacing: 14,
        mainAxisSpacing: 14,
      ),
      itemCount: controller.catalog.length,
      itemBuilder: (context, index) {
        final item = controller.catalog[index];
        return _CatalogCard(
          item: item,
          onTap: () => ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('O player será conectado na próxima etapa.'),
            ),
          ),
        );
      },
    );
  }
}

class _CatalogCard extends StatelessWidget {
  const _CatalogCard({required this.item, required this.onTap});

  final CatalogItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: _surface,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: item.imageUrl.isEmpty
                  ? const _CatalogPlaceholder()
                  : Image.network(
                      item.imageUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const _CatalogPlaceholder(),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                item.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: _textPrimary,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CatalogPlaceholder extends StatelessWidget {
  const _CatalogPlaceholder();

  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: _surfaceLight,
    child: Center(
      child: Icon(Icons.play_circle_outline, color: _accent, size: 46),
    ),
  );
}

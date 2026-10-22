class AuthSession {
  const AuthSession({
    required this.idToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String idToken;
  final String refreshToken;
  final DateTime expiresAt;
}

class Account {
  const Account({
    required this.screens,
    required this.profileNames,
    required this.accountType,
  });

  final int screens;
  final List<String> profileNames;
  final String accountType;

  String profileName(int index) {
    if (index >= 0 && index < profileNames.length) {
      final name = profileNames[index].trim();
      if (name.isNotEmpty) return name;
    }
    return 'Perfil ${index + 1}';
  }
}

class SavedCredentials {
  const SavedCredentials({required this.login, required this.password});

  final String login;
  final String password;
}

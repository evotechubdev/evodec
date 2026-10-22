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

enum MediaKind { live, movie, series }

extension MediaKindLabels on MediaKind {
  String get label => switch (this) {
    MediaKind.live => 'Canais',
    MediaKind.movie => 'Filmes',
    MediaKind.series => 'Séries',
  };

  String get section => switch (this) {
    MediaKind.live => 'channels',
    MediaKind.movie => 'movies',
    MediaKind.series => 'series',
  };
}

class PlaybackGrant {
  const PlaybackGrant({
    required this.server,
    required this.username,
    required this.password,
    required this.profile,
    required this.expiresAt,
  });

  final String server;
  final String username;
  final String password;
  final int profile;
  final DateTime expiresAt;
}

class ProfileSession {
  const ProfileSession({
    required this.sessionToken,
    required this.playbackGrant,
  });

  final String sessionToken;
  final PlaybackGrant playbackGrant;
}

class CatalogItem {
  const CatalogItem({
    required this.id,
    required this.name,
    required this.categoryId,
    required this.extension,
    required this.imageUrl,
    required this.kind,
  });

  final String id;
  final String name;
  final String categoryId;
  final String extension;
  final String imageUrl;
  final MediaKind kind;
}

class CatalogPage {
  const CatalogPage({
    required this.items,
    required this.page,
    required this.total,
    required this.hasMore,
  });

  final List<CatalogItem> items;
  final int page;
  final int total;
  final bool hasMore;
}

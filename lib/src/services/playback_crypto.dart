import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:fast_rsa/fast_rsa.dart';

import '../models.dart';

class PlaybackKeys {
  PlaybackKeys._(this._privateKey, this.publicKey);

  final String _privateKey;
  final String publicKey;

  static Future<PlaybackKeys> generate() async {
    final pair = await RSA.generate(2048);
    final pkix = await RSA.convertPublicKeyToPKIX(pair.publicKey);
    final encoded = pkix.replaceAll(RegExp(r'-----[^-]+-----|\s'), '');
    if (encoded.isEmpty) {
      throw const FormatException('Não foi possível gerar a chave de reprodução.');
    }
    return PlaybackKeys._(pair.privateKey, encoded);
  }

  Future<PlaybackGrant> decrypt(
    Map<String, dynamic> envelope,
    int expectedProfile,
  ) async {
    if (_asInt(envelope['version']) != 1) {
      throw const FormatException('Autorização de reprodução inválida.');
    }

    final encryptedKey = _decodeUrl(_requiredString(envelope, 'key'));
    final key = await RSA.decryptOAEPBytes(
      Uint8List.fromList(encryptedKey),
      '',
      Hash.SHA256,
      _privateKey,
    );
    final iv = _decodeUrl(_requiredString(envelope, 'iv'));
    final encryptedData = _decodeUrl(_requiredString(envelope, 'data'));
    final tag = _decodeUrl(_requiredString(envelope, 'tag'));
    final algorithm = key.length == 16
        ? AesGcm.with128bits()
        : AesGcm.with256bits();
    final clear = await algorithm.decrypt(
      SecretBox(encryptedData, nonce: iv, mac: Mac(tag)),
      secretKey: SecretKey(key),
    );
    final decoded = jsonDecode(utf8.decode(clear));
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Autorização de reprodução inválida.');
    }

    final server = Uri.tryParse(_requiredString(decoded, 'server'));
    final profile = _asInt(decoded['profile']);
    final expiresAt = _asInt(decoded['expiresAt']);
    if (server == null ||
        !const {'http', 'https'}.contains(server.scheme) ||
        server.userInfo.isNotEmpty ||
        server.hasQuery ||
        server.hasFragment ||
        profile != expectedProfile ||
        decoded['type'] != 'profile-playback' ||
        expiresAt <= DateTime.now().millisecondsSinceEpoch) {
      throw const FormatException('Autorização de reprodução inválida.');
    }

    return PlaybackGrant(
      server: server.toString().replaceFirst(RegExp(r'/+$'), ''),
      username: _requiredString(decoded, 'username'),
      password: _requiredString(decoded, 'password'),
      profile: profile,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(expiresAt),
    );
  }

  static List<int> _decodeUrl(String value) {
    final normalized = base64Url.normalize(value);
    return base64Url.decode(normalized);
  }

  static String _requiredString(Map<String, dynamic> data, String key) {
    final value = data[key]?.toString() ?? '';
    if (value.isEmpty) throw FormatException('Campo ausente: $key.');
    return value;
  }

  static int _asInt(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import 'models.dart';

const _playerBackground = Color(0xFF07080A);
const _playerAccent = Color(0xFF25D8FF);

class PlaybackScreen extends StatefulWidget {
  const PlaybackScreen({
    required this.item,
    required this.source,
    super.key,
  });

  final CatalogItem item;
  final Uri source;

  @override
  State<PlaybackScreen> createState() => _PlaybackScreenState();
}

class _PlaybackScreenState extends State<PlaybackScreen>
    with WidgetsBindingObserver {
  late final VideoPlayerController _player;
  late final Future<void> _initialization;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _player = VideoPlayerController.networkUrl(widget.source);
    _initialization = _initialize();
  }

  Future<void> _initialize() async {
    await _player.initialize();
    await _player.setLooping(false);
    await _player.play();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      _player.pause();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _playerBackground,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: Text(
          widget.item.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: FutureBuilder<void>(
        future: _initialization,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return _PlaybackError(onClose: () => Navigator.of(context).pop());
          }
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(
              child: CircularProgressIndicator(color: _playerAccent),
            );
          }
          return _PlayerView(player: _player, item: widget.item);
        },
      ),
    );
  }
}

class _PlayerView extends StatelessWidget {
  const _PlayerView({required this.player, required this.item});

  final VideoPlayerController player;
  final CatalogItem item;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<VideoPlayerValue>(
      valueListenable: player,
      builder: (context, value, _) {
        final aspectRatio = value.aspectRatio > 0 ? value.aspectRatio : 16 / 9;
        return Center(
          child: AspectRatio(
            aspectRatio: aspectRatio,
            child: Stack(
              fit: StackFit.expand,
              children: [
                ColoredBox(
                  color: Colors.black,
                  child: VideoPlayer(player),
                ),
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => value.isPlaying ? player.pause() : player.play(),
                  child: AnimatedOpacity(
                    opacity: value.isPlaying && !value.isBuffering ? 0 : 1,
                    duration: const Duration(milliseconds: 180),
                    child: ColoredBox(
                      color: Colors.black38,
                      child: Center(
                        child: value.isBuffering
                            ? const CircularProgressIndicator(
                                color: _playerAccent,
                              )
                            : Icon(
                                value.isPlaying
                                    ? Icons.pause_circle_filled
                                    : Icons.play_circle_fill,
                                color: Colors.white,
                                size: 76,
                              ),
                      ),
                    ),
                  ),
                ),
                if (item.kind == MediaKind.live)
                  const Positioned(
                    top: 14,
                    right: 14,
                    child: _LiveBadge(),
                  ),
                if (item.kind != MediaKind.live)
                  Positioned(
                    left: 12,
                    right: 12,
                    bottom: 8,
                    child: VideoProgressIndicator(
                      player,
                      allowScrubbing: true,
                      colors: const VideoProgressColors(
                        playedColor: _playerAccent,
                        bufferedColor: Colors.white38,
                        backgroundColor: Colors.white24,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _LiveBadge extends StatelessWidget {
  const _LiveBadge();

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xFFD3223A),
      borderRadius: BorderRadius.circular(6),
    ),
    child: const Padding(
      padding: EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      child: Text(
        'AO VIVO',
        style: TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w900,
          letterSpacing: .8,
        ),
      ),
    ),
  );
}

class _PlaybackError extends StatelessWidget {
  const _PlaybackError({required this.onClose});

  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Color(0xFFFF7A67), size: 52),
            const SizedBox(height: 14),
            const Text(
              'Não foi possível reproduzir este conteúdo.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 17),
            ),
            const SizedBox(height: 18),
            OutlinedButton(onPressed: onClose, child: const Text('VOLTAR')),
          ],
        ),
      ),
    );
  }
}

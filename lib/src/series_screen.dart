import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'models.dart';
import 'playback_screen.dart';

const _seriesBackground = Color(0xFF07080A);
const _seriesSurface = Color(0xFF15181E);
const _seriesAccent = Color(0xFF25D8FF);
const _seriesMuted = Color(0xFF9299A5);

class SeriesScreen extends StatefulWidget {
  const SeriesScreen({
    required this.controller,
    required this.series,
    super.key,
  });

  final AppController controller;
  final CatalogItem series;

  @override
  State<SeriesScreen> createState() => _SeriesScreenState();
}

class _SeriesScreenState extends State<SeriesScreen> {
  late Future<SeriesDetails> _details;

  @override
  void initState() {
    super.initState();
    _details = widget.controller.loadSeries(widget.series);
  }

  void _retry() {
    setState(() => _details = widget.controller.loadSeries(widget.series));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _seriesBackground,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Text(
          widget.series.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: FutureBuilder<SeriesDetails>(
        future: _details,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return _SeriesError(error: snapshot.error, onRetry: _retry);
          }
          final details = snapshot.data;
          if (details == null) {
            return const Center(
              child: CircularProgressIndicator(color: _seriesAccent),
            );
          }
          return _SeriesContent(
            controller: widget.controller,
            details: details,
          );
        },
      ),
    );
  }
}

class _SeriesContent extends StatelessWidget {
  const _SeriesContent({required this.controller, required this.details});

  final AppController controller;
  final SeriesDetails details;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      children: [
        if (details.coverUrl.isNotEmpty)
          Center(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(
                details.coverUrl,
                width: 180,
                height: 260,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    const SizedBox.shrink(),
              ),
            ),
          ),
        const SizedBox(height: 18),
        Text(
          details.title,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        if (details.plot.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(
            details.plot,
            textAlign: TextAlign.center,
            style: const TextStyle(color: _seriesMuted, height: 1.45),
          ),
        ],
        const SizedBox(height: 22),
        if (details.seasons.isEmpty)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'Nenhum episódio disponível para esta série.',
              textAlign: TextAlign.center,
              style: TextStyle(color: _seriesMuted),
            ),
          )
        else
          ...details.seasons.map(
            (season) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Material(
                color: _seriesSurface,
                borderRadius: BorderRadius.circular(16),
                clipBehavior: Clip.antiAlias,
                child: ExpansionTile(
                  initiallyExpanded: season == details.seasons.first,
                  iconColor: _seriesAccent,
                  collapsedIconColor: _seriesMuted,
                  title: Text(
                    season.label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  subtitle: Text(
                    '${season.episodes.length} episódios',
                    style: const TextStyle(color: _seriesMuted),
                  ),
                  children: season.episodes
                      .map(
                        (episode) => ListTile(
                          leading: CircleAvatar(
                            backgroundColor: const Color(0xFF006DFF),
                            child: Text(
                              '${episode.number}',
                              style: const TextStyle(color: Colors.white),
                            ),
                          ),
                          title: Text(
                            episode.title,
                            style: const TextStyle(color: Colors.white),
                          ),
                          subtitle: episode.duration.isEmpty
                              ? null
                              : Text(
                                  _durationLabel(episode.duration),
                                  style: const TextStyle(color: _seriesMuted),
                                ),
                          trailing: const Icon(
                            Icons.play_circle_fill,
                            color: _seriesAccent,
                          ),
                          onTap: () => _play(context, episode),
                        ),
                      )
                      .toList(growable: false),
                ),
              ),
            ),
          ),
      ],
    );
  }

  void _play(BuildContext context, SeriesEpisode episode) {
    try {
      final item = episode.asCatalogItem(details.title);
      final source = controller.playbackSource(item);
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PlaybackScreen(item: item, source: source),
        ),
      );
    } on Object catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  String _durationLabel(String raw) {
    final seconds = int.tryParse(raw);
    if (seconds == null) return raw;
    final duration = Duration(seconds: seconds);
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60);
    return hours > 0 ? '${hours}h ${minutes}min' : '${minutes}min';
  }
}

class _SeriesError extends StatelessWidget {
  const _SeriesError({required this.error, required this.onRetry});

  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, color: Color(0xFFFF7A67), size: 52),
          const SizedBox(height: 12),
          Text(
            error?.toString() ?? 'Não foi possível carregar os episódios.',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white),
          ),
          const SizedBox(height: 18),
          FilledButton(onPressed: onRetry, child: const Text('TENTAR NOVAMENTE')),
        ],
      ),
    ),
  );
}

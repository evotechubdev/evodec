export type MediaKind = 'live' | 'movie' | 'series';

export const mediaKinds: readonly MediaKind[] = ['live', 'movie', 'series'];

export const mediaLabels: Record<MediaKind, string> = {
  live: 'Canais',
  movie: 'Filmes',
  series: 'Séries',
};

export const mediaSections: Record<MediaKind, string> = {
  live: 'channels',
  movie: 'movies',
  series: 'series',
};

export interface AuthSession {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface Account {
  screens: number;
  profileNames: string[];
  accountType: string;
}

export interface PlaybackGrant {
  server: string;
  username: string;
  password: string;
  profile: number;
  expiresAt: number;
}

export interface ProfileSession {
  sessionToken: string;
  playbackGrant: PlaybackGrant;
}

export interface CatalogItem {
  id: string;
  name: string;
  categoryId: string;
  extension: string;
  imageUrl: string;
  kind: MediaKind;
}

export interface CatalogPage {
  items: CatalogItem[];
  page: number;
  total: number;
  hasMore: boolean;
}

export interface SeriesEpisode {
  id: string;
  number: number;
  title: string;
  duration: string;
  extension: string;
}

export interface SeriesSeason {
  number: number;
  episodes: SeriesEpisode[];
}

export interface SeriesDetails {
  title: string;
  plot: string;
  coverUrl: string;
  seasons: SeriesSeason[];
}

export function profileName(account: Account, index: number): string {
  const configured = account.profileNames[index]?.trim();
  return configured || `Perfil ${index + 1}`;
}

export function episodeAsCatalogItem(
  episode: SeriesEpisode,
  seriesTitle: string,
): CatalogItem {
  return {
    id: episode.id,
    name: `${seriesTitle} — ${episode.title}`,
    categoryId: '',
    extension: episode.extension,
    imageUrl: '',
    kind: 'series',
  };
}

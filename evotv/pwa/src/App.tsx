import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

import { EvoApi, EvoApiError } from './api';
import { PWA_VERSION } from './pwa-version';
import { clearSavedLogin, loadSavedLogin, saveLogin } from './storage';
import {
  type Account,
  type AuthSession,
  type CatalogCategory,
  type CatalogItem,
  type MediaKind,
  type ProfileSession,
  type ProfileSettings,
  type SeriesDetails,
  type SeriesEpisode,
  episodeAsCatalogItem,
  mediaKinds,
  mediaLabels,
  primaryCategories,
  profileName,
} from './types';

type Screen = 'login' | 'profiles' | 'catalog' | 'series';

const api = new EvoApi();
const isPwaPath = /\/pwa(?:\/|$)/.test(window.location.pathname);
const assetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${isPwaPath ? '../' : ''}${path}`;
const ANDROID_DOWNLOAD_URL =
  'https://github.com/evotechubdev/evodec/releases/download/v1.0.7/EVOTV.Android.1.0.7.apk';
const WINDOWS_DOWNLOAD_URL =
  'https://github.com/evotechubdev/evodec/releases/download/v1.0.7/programa.de.PC.EVOTV.Setup.0.0.3.exe';
const PUBLIC_CONTACTS_URL =
  'https://firestore.googleapis.com/v1/projects/multimideas-evotv/databases/(default)/documents/public/contatos';

interface PublicContacts {
  support: string;
  commercial: string;
}

interface ActivePlayback {
  item: CatalogItem;
  source: string;
}

export default function App() {
  const openPlayer = isPwaPath || isStandalone();
  return openPlayer ? <PlayerApp /> : <SupportPortal />;
}

function SupportPortal() {
  const [contacts, setContacts] = useState<PublicContacts | null>(null);
  const [contactsLoading, setContactsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(PUBLIC_CONTACTS_URL, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Firestore respondeu ${response.status}`);
        const data = (await response.json()) as {
          fields?: Record<string, { stringValue?: string }>;
        };
        setContacts({
          support: normalizePhone(data.fields?.whatsapp_suporte?.stringValue),
          commercial: normalizePhone(data.fields?.whatsapp_comercial?.stringValue),
        });
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setContacts(null);
        }
      })
      .finally(() => setContactsLoading(false));
    return () => controller.abort();
  }, []);

  return (
    <div className="support-site">
      <div className="support-glow support-glow-one" />
      <div className="support-glow support-glow-two" />
      <header className="support-header">
        <a className="support-brand" href="#inicio" aria-label="EVOTV - início">
          <img src={assetUrl('images/logo_evotv.png')} alt="EVOTV" />
        </a>
      </header>

      <main className="support-main" id="inicio">
        <section className="support-options">
          <div className="support-section-heading">
            <h1>Escolha sua versão</h1>
            <p>Selecione seu sistema para baixar ou instalar.</p>
          </div>
          <div className="download-grid">
            <DownloadCard
              icon="android"
              title="EVOTV - Android"
              version="1.0.7"
              description="Para celulares, tablets, TV Box e Smart TVs com Android."
              href={ANDROID_DOWNLOAD_URL}
              label="Baixar APK"
            />
            <DownloadCard
              icon="windows"
              title="EVOTV - PC Windows"
              version="0.3"
              description="Aplicativo completo para computadores e notebooks Windows."
              href={WINDOWS_DOWNLOAD_URL}
              label="Baixar para Windows"
            />
            <DownloadCard
              icon="pwa"
              title="EVOTV - PWA"
              description="Indicada para iOS e outros sistemas de TV ou dispositivos."
              label="Instalar PWA"
              href={assetUrl('pwa/index.html?install=1')}
              featured
            />
          </div>
          <div className="contact-heading">
            <h2>Precisa de ajuda?</h2>
            <p>Fale com nossa equipe pelo canal adequado.</p>
          </div>
          <div className="contact-grid">
            <ContactCard
              kind="support"
              title="Suporte técnico"
              text="Ajuda com acesso, instalação ou funcionamento do aplicativo."
              phone={contacts?.support || ''}
              loading={contactsLoading}
            />
            <ContactCard
              kind="commercial"
              title="Contato comercial"
              text="Planos, novas assinaturas e informações para representantes."
              phone={contacts?.commercial || ''}
              loading={contactsLoading}
            />
          </div>
        </section>
      </main>

      <footer className="support-footer">
        <img src={assetUrl('images/logo_evotv.png')} alt="EVOTV" />
        <span>© {new Date().getFullYear()} EVOTV. Todos os direitos reservados.</span>
      </footer>
    </div>
  );
}

function DownloadCard({
  icon,
  title,
  version,
  description,
  href,
  label,
  featured = false,
  onClick,
}: {
  icon: 'android' | 'windows' | 'pwa';
  title: string;
  version?: string;
  description: string;
  href?: string;
  label: string;
  featured?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <PlatformIcon platform={icon} />
      <span className="download-card-copy">
        <strong>{title} {version && <small>(versão: {version})</small>}</strong>
        <span>{description}</span>
      </span>
      <span className="download-action">{label}<b aria-hidden="true">→</b></span>
    </>
  );
  if (href) {
    return <a className={`download-card${featured ? ' featured' : ''}`} href={href}>{content}</a>;
  }
  return <button className={`download-card${featured ? ' featured' : ''}`} onClick={onClick}>{content}</button>;
}

function PlatformIcon({ platform }: { platform: 'android' | 'windows' | 'pwa' }) {
  const logo = platform === 'pwa' ? 'apple' : platform;
  const label = platform === 'android' ? 'Android' : platform === 'windows' ? 'Windows' : 'PWA • iOS + TV';
  return (
    <span className={`platform-icon platform-${platform}`}>
      <img src={assetUrl(`brands/${logo}.svg`)} alt="" />
      <small>{label}</small>
    </span>
  );
}

function ContactCard({
  kind,
  title,
  text,
  phone,
  loading,
}: {
  kind: 'support' | 'commercial';
  title: string;
  text: string;
  phone: string;
  loading: boolean;
}) {
  const message = kind === 'support'
    ? 'Olá! Preciso de ajuda com o EVOTV.'
    : 'Olá! Gostaria de informações comerciais sobre o EVOTV.';
  return (
    <article className="contact-card">
      <span className={`contact-icon contact-${kind}`} aria-hidden="true">{kind === 'support' ? '?' : '↗'}</span>
      <div><h3>{title}</h3><p>{text}</p></div>
      {phone ? (
        <a
          className="contact-action"
          href={`https://wa.me/${withBrazilCountryCode(phone)}?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`${title}: ${formatPhone(phone)}`}
        >
          <span>{formatPhone(phone)}</span>
          Chamar no WhatsApp
        </a>
      ) : (
        <span className="contact-pending">
          {loading ? 'Carregando contato…' : 'Contato temporariamente indisponível'}
        </span>
      )}
    </article>
  );
}

function normalizePhone(value: string | undefined): string {
  return (value || '').replace(/\D/g, '').slice(0, 15);
}

function withBrazilCountryCode(phone: string): string {
  return phone.startsWith('55') ? phone : `55${phone}`;
}

function formatPhone(phone: string): string {
  const local = phone.startsWith('55') && phone.length > 11 ? phone.slice(2) : phone;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return `+${withBrazilCountryCode(local)}`;
}

function PlayerApp() {
  const initialLogin = useMemo(loadSavedLogin, []);
  const [screen, setScreen] = useState<Screen>('login');
  const [login, setLogin] = useState(initialLogin);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(initialLogin));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [profileSession, setProfileSession] = useState<ProfileSession | null>(null);
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [pendingProfile, setPendingProfile] = useState(0);
  const [profilePin, setProfilePin] = useState('');
  const [profilePinError, setProfilePinError] = useState('');
  const [profileSettings, setProfileSettings] = useState<ProfileSettings | null>(null);
  const [profileSettingsError, setProfileSettingsError] = useState('');
  const [selectedKind, setSelectedKind] = useState<MediaKind>('live');
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(primaryCategories.live.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [seriesItem, setSeriesItem] = useState<CatalogItem | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesDetails | null>(null);
  const [activePlayback, setActivePlayback] = useState<ActivePlayback | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(
    shouldShowInstallHelpFromRedirect,
  );
  const profileSelectionInFlight = useRef(false);
  const catalogRequestId = useRef(0);

  useTvSpatialNavigation();

  useEffect(() => {
    const url = new URL(window.location.href);
    const openGuide = url.searchParams.get('install') === '1';
    const releaseRefresh = url.searchParams.has('evotv-release');
    if (!openGuide && !releaseRefresh) return;
    url.searchParams.delete('install');
    url.searchParams.delete('evotv-release');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  useEffect(() => {
    if (!auth || !profileSession || selectedProfile < 1) return;
    const controller = new AbortController();
    void api
      .watchSession(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        controller.signal,
      )
      .then((ended) => {
        if (ended && !controller.signal.aborted) endProfileSession(ended.message);
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          // Uma interrupção de rede não significa que o perfil foi substituído.
        }
      });
    return () => controller.abort();
  }, [auth, profileSession, selectedProfile]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!login.trim() || !password) {
      setError('Informe login e senha para continuar.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextAuth = await api.signIn(login, password);
      const nextAccount = await api.account(nextAuth.idToken);
      if (remember) saveLogin(login);
      else clearSavedLogin();
      setAuth(nextAuth);
      setAccount(nextAccount);
      setPassword('');
      setScreen('profiles');
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  function requestProfilePin(profile: number) {
    if (busy) return;
    setPendingProfile(profile);
    setProfilePin('');
    setProfilePinError('');
    setError('');
  }

  async function chooseProfile(event: FormEvent) {
    event.preventDefault();
    const profile = pendingProfile;
    if (!auth || busy || profileSelectionInFlight.current) return;
    if (profilePin.length < 4) {
      setProfilePinError('Digite o PIN deste perfil (4 a 128 caracteres).');
      return;
    }
    profileSelectionInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const nextSession = await api.selectProfile(auth.idToken, profile, profilePin);
      const category = primaryCategories.live.id;
      const [nextCategories, page] = await Promise.all([
        api.categories(auth.idToken, nextSession.sessionToken, profile, 'live'),
        api.catalog(auth.idToken, nextSession.sessionToken, profile, 'live', {
          category,
        }),
      ]);
      setProfileSession(nextSession);
      setSelectedProfile(profile);
      setSelectedKind('live');
      setCategories(nextCategories);
      setSelectedCategory(category);
      setSearchQuery('');
      setCatalog(page.items);
      setCatalogPage(page.page);
      setCatalogTotal(page.total);
      setCatalogHasMore(page.hasMore);
      setPendingProfile(0);
      setProfilePin('');
      setScreen('catalog');
    } catch (reason) {
      setProfileSession(null);
      setSelectedProfile(0);
      setProfilePinError(readableError(reason));
    } finally {
      profileSelectionInFlight.current = false;
      setBusy(false);
    }
  }

  async function openProfileSettings() {
    if (!auth || !profileSession || selectedProfile !== 1 || busy) return;
    setBusy(true); setProfileSettingsError('');
    try {
      setProfileSettings(await api.profileSettings(auth.idToken, profileSession.sessionToken, selectedProfile));
    } catch (reason) { setError(readableError(reason)); }
    finally { setBusy(false); }
  }

  async function saveProfileSettings(event: FormEvent) {
    event.preventDefault();
    if (!auth || !profileSession || !profileSettings || busy) return;
    if (profileSettings.profiles.some((item) => !item.name.trim())) { setProfileSettingsError('Defina o nome de todos os perfis.'); return; }
    if (profileSettings.profiles.some((item) => item.pin && item.pin.length < 4)) { setProfileSettingsError('Use PINs de perfil com 4 a 128 caracteres.'); return; }
    setBusy(true); setProfileSettingsError('');
    try {
      const result = await api.saveProfileSettings(auth.idToken, profileSession.sessionToken, selectedProfile, profileSettings);
      setAccount((current) => current ? { ...current, profileNames: result.profileNames } : current);
      setProfileSettings(null); setProfileSession(null); setSelectedProfile(0); setCatalog([]); setScreen('profiles');
      setError('Perfis atualizados. Digite o PIN do perfil para continuar.');
    } catch (reason) { setProfileSettingsError(readableError(reason)); }
    finally { setBusy(false); }
  }

  async function changeKind(kind: MediaKind) {
    if (!auth || !profileSession || busy || kind === selectedKind) return;
    const requestId = ++catalogRequestId.current;
    const category = primaryCategories[kind].id;
    setSelectedKind(kind);
    setCategories([]);
    setSelectedCategory(category);
    setSearchQuery('');
    setCatalog([]);
    setCatalogTotal(0);
    setCatalogHasMore(false);
    setCatalogLoadingMore(false);
    setBusy(true);
    setError('');
    try {
      const [nextCategories, page] = await Promise.all([
        api.categories(
          auth.idToken,
          profileSession.sessionToken,
          selectedProfile,
          kind,
        ),
        api.catalog(
          auth.idToken,
          profileSession.sessionToken,
          selectedProfile,
          kind,
          { category },
        ),
      ]);
      if (requestId !== catalogRequestId.current) return;
      setCategories(nextCategories);
      setCatalog(page.items);
      setCatalogPage(page.page);
      setCatalogTotal(page.total);
      setCatalogHasMore(page.hasMore);
    } catch (reason) {
      if (requestId !== catalogRequestId.current) return;
      setError(readableError(reason));
    } finally {
      if (requestId === catalogRequestId.current) setBusy(false);
    }
  }

  async function filterCatalog(category: string, query: string) {
    if (!auth || !profileSession || busy) return;
    const requestId = ++catalogRequestId.current;
    const normalizedQuery = query.trim().slice(0, 100);
    setSelectedCategory(category);
    setSearchQuery(normalizedQuery);
    setCatalog([]);
    setCatalogTotal(0);
    setCatalogHasMore(false);
    setCatalogLoadingMore(false);
    setBusy(true);
    setError('');
    try {
      const page = await api.catalog(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        selectedKind,
        { category, query: normalizedQuery },
      );
      if (requestId !== catalogRequestId.current) return;
      setCatalog(page.items);
      setCatalogPage(page.page);
      setCatalogTotal(page.total);
      setCatalogHasMore(page.hasMore);
    } catch (reason) {
      if (requestId !== catalogRequestId.current) return;
      setError(readableError(reason));
    } finally {
      if (requestId === catalogRequestId.current) setBusy(false);
    }
  }

  async function loadMoreCatalog() {
    if (
      !auth ||
      !profileSession ||
      busy ||
      catalogLoadingMore ||
      !catalogHasMore
    ) return;
    const requestId = catalogRequestId.current;
    const nextPage = catalogPage + 1;
    setCatalogLoadingMore(true);
    setError('');
    try {
      const page = await api.catalog(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        selectedKind,
        {
          category: selectedCategory,
          query: searchQuery,
          page: nextPage,
        },
      );
      if (requestId !== catalogRequestId.current) return;
      setCatalog((current) => {
        const known = new Set(current.map((item) => `${item.kind}:${item.id}`));
        return [
          ...current,
          ...page.items.filter((item) => !known.has(`${item.kind}:${item.id}`)),
        ];
      });
      setCatalogPage(page.page);
      setCatalogTotal(page.total);
      setCatalogHasMore(page.hasMore);
    } catch (reason) {
      if (requestId !== catalogRequestId.current) return;
      setError(readableError(reason));
    } finally {
      if (requestId === catalogRequestId.current) setCatalogLoadingMore(false);
    }
  }

  async function openSeries(item: CatalogItem) {
    if (!auth || !profileSession) return;
    setSeriesItem(item);
    setSeriesDetails(null);
    setError('');
    setScreen('series');
    setBusy(true);
    try {
      const details = await api.seriesDetails(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        item,
      );
      setSeriesDetails(details);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function playItem(item: CatalogItem) {
    if (!auth || !profileSession || busy) return;
    setBusy(true);
    setError('');
    try {
      const source = await api.directPlaybackUrl(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        item,
        profileSession.playbackGrant,
      );
      setActivePlayback({ item, source });
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function releaseProfile() {
    const currentAuth = auth;
    const currentSession = profileSession;
    const currentProfile = selectedProfile;
    setProfileSession(null);
    setActivePlayback(null);
    setSelectedProfile(0);
    catalogRequestId.current += 1;
    setCategories([]);
    setSelectedCategory(primaryCategories.live.id);
    setSearchQuery('');
    setCatalog([]);
    setCatalogTotal(0);
    setCatalogHasMore(false);
    setCatalogLoadingMore(false);
    setSeriesItem(null);
    setSeriesDetails(null);
    if (currentAuth && currentSession && currentProfile > 0) {
      await api.releaseProfile(
        currentAuth.idToken,
        currentSession.sessionToken,
        currentProfile,
      );
    }
  }

  async function backToProfiles() {
    if (busy) return;
    setBusy(true);
    setError('');
    await releaseProfile();
    setScreen('profiles');
    setBusy(false);
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    await releaseProfile();
    setAuth(null);
    setAccount(null);
    setScreen('login');
    setError('');
    if (!remember) setLogin('');
    setBusy(false);
  }

  function openInstallGuide() {
    setShowInstallHelp(true);
  }

  function closeInstallHelp() {
    setShowInstallHelp(false);
  }

  function endProfileSession(message: string) {
    setError(message);
    setProfileSession(null);
    setActivePlayback(null);
    setSelectedProfile(0);
    catalogRequestId.current += 1;
    setCategories([]);
    setSearchQuery('');
    setCatalog([]);
    setSeriesItem(null);
    setSeriesDetails(null);
    setScreen('profiles');
  }

  const currentProfileName =
    account && selectedProfile > 0
      ? profileName(account, selectedProfile - 1)
      : '';

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      {screen !== 'login' && (
        <Header
          profileName={currentProfileName}
          onManageProfiles={selectedProfile === 1 ? () => void openProfileSettings() : undefined}
          onLogout={logout}
        />
      )}

      <main className="main-content">
        {screen === 'login' && (
          <LoginScreen
            login={login}
            password={password}
            remember={remember}
            busy={busy}
            error={error}
            onLogin={setLogin}
            onPassword={setPassword}
            onRemember={(checked) => {
              setRemember(checked);
              if (!checked) clearSavedLogin();
            }}
            onSubmit={signIn}
            onOpenInstallGuide={openInstallGuide}
          />
        )}

        {screen === 'profiles' && account && (
          <ProfilesScreen
            account={account}
            busy={busy}
            error={error}
            onSelect={requestProfilePin}
          />
        )}

        {pendingProfile > 0 && account && (
          <ProfilePinDialog
            profileName={profileName(account, pendingProfile - 1)}
            pin={profilePin}
            busy={busy}
            error={profilePinError}
            onPin={setProfilePin}
            onSubmit={chooseProfile}
            onClose={() => {
              if (busy) return;
              setPendingProfile(0);
              setProfilePin('');
              setProfilePinError('');
            }}
          />
        )}

        {profileSettings && (
          <ProfileSettingsDialog
            settings={profileSettings}
            busy={busy}
            error={profileSettingsError}
            onChange={setProfileSettings}
            onSubmit={saveProfileSettings}
            onClose={() => { if (!busy) { setProfileSettings(null); setProfileSettingsError(''); } }}
          />
        )}

        {screen === 'catalog' && (
          <CatalogScreen
            kind={selectedKind}
            categories={categories}
            selectedCategory={selectedCategory}
            searchQuery={searchQuery}
            catalog={catalog}
            total={catalogTotal}
            hasMore={catalogHasMore}
            loadingMore={catalogLoadingMore}
            busy={busy}
            error={error}
            onBack={backToProfiles}
            onChangeKind={changeKind}
            onChangeCategory={(category) => void filterCatalog(category, searchQuery)}
            onSearch={(query) => void filterCatalog(selectedCategory, query)}
            onLoadMore={() => void loadMoreCatalog()}
            onOpen={(item) =>
              item.kind === 'series'
                ? void openSeries(item)
                : void playItem(item)
            }
          />
        )}

        {screen === 'series' && seriesItem && (
          <SeriesScreen
            item={seriesItem}
            details={seriesDetails}
            busy={busy}
            error={error}
            onBack={() => {
              setError('');
              setScreen('catalog');
            }}
            onRetry={() => void openSeries(seriesItem)}
            onPlay={(episode) =>
              void playItem(
                episodeAsCatalogItem(
                  episode,
                  seriesDetails?.title || seriesItem.name,
                ),
              )
            }
          />
        )}

      </main>

      {showInstallHelp && (
        <InstallHelp onClose={closeInstallHelp} />
      )}
      {activePlayback && (
        <InternalMediaPlayer
          playback={activePlayback}
          onClose={() => setActivePlayback(null)}
        />
      )}
      {screen === 'login' && (
        <span className="pwa-version" aria-label={`Versão do PWA: ${PWA_VERSION}`}>
          Versão: {PWA_VERSION}
        </span>
      )}
    </div>
  );
}

function InternalMediaPlayer({ playback, onClose }: {
  playback: ActivePlayback;
  onClose(): void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const directHttp = (() => {
    try { return new URL(playback.source).protocol === 'http:'; }
    catch { return false; }
  })();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let transportStreamPlayer: ReturnType<typeof mpegts.createPlayer> | null = null;
    let disposed = false;
    setLoading(true);
    setNeedsPlay(false);
    setPlayerError('');

    const startPlayback = () => {
      if (disposed) return;
      void video.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    };
    const isHls = (() => {
      try { return new URL(playback.source).pathname.toLowerCase().endsWith('.m3u8'); }
      catch { return false; }
    })();
    const isTransportStream = (() => {
      try {
        const path = new URL(playback.source).pathname.toLowerCase();
        return playback.item.kind === 'live' && (path.endsWith('.ts') || path.endsWith('.mpegts'));
      } catch { return false; }
    })();

    if (isTransportStream && mpegts.isSupported()) {
      transportStreamPlayer = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        cors: true,
        withCredentials: false,
        url: playback.source,
      }, {
        // A blob-based transmuxing worker may send the media request with an
        // opaque Origin, which the protected edge proxy must reject. Keep IO
        // in the authorized PWA context instead of weakening origin checks.
        enableWorker: false,
        enableStashBuffer: false,
        isLive: true,
        liveBufferLatencyChasing: true,
      });
      transportStreamPlayer.attachMediaElement(video);
      transportStreamPlayer.on(mpegts.Events.MEDIA_INFO, startPlayback);
      transportStreamPlayer.on(mpegts.Events.ERROR, () => {
        if (disposed) return;
        setLoading(false);
        setPlayerError('A transmissao do canal foi interrompida. Feche o player e tente novamente.');
      });
      transportStreamPlayer.load();
      startPlayback();
    } else if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (!Hls.isSupported()) {
        setLoading(false);
        setPlayerError('Este navegador não oferece um decodificador compatível com esta transmissão.');
      } else {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          manifestLoadingTimeOut: 60_000,
          levelLoadingTimeOut: 60_000,
          fragLoadingTimeOut: 60_000,
        });
        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(playback.source));
        hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || disposed) return;
          setLoading(false);
          setPlayerError(
            mediaProxyErrorMessage(data.response?.text) ||
            'A transmissão foi interrompida. Feche o player e tente novamente.',
          );
        });
      }
    } else {
      video.src = playback.source;
      video.addEventListener('loadedmetadata', startPlayback, { once: true });
      video.load();
    }

    return () => {
      disposed = true;
      hls?.destroy();
      transportStreamPlayer?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [playback.source]);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (panelRef.current?.requestFullscreen) {
      await panelRef.current.requestFullscreen().catch(() => {});
      return;
    }
    const iosVideo = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    iosVideo?.webkitEnterFullscreen?.();
  }

  function resumePlayback() {
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(() => setNeedsPlay(false)).catch(() => {
      setPlayerError('Toque novamente no botão de reprodução do player.');
    });
  }

  return (
    <div className="media-player-backdrop" role="presentation">
      <section ref={panelRef} className="media-player-modal" role="dialog" aria-modal="true" aria-labelledby="media-player-title">
        <header className="media-player-header">
          <div>
            <span>{playback.item.kind === 'live' ? 'AO VIVO' : mediaLabels[playback.item.kind]}{directHttp ? ' - HTTP DIRETO' : ''}</span>
            <strong id="media-player-title">{playback.item.name}</strong>
          </div>
          <div className="media-player-actions">
            <button type="button" onClick={() => void toggleFullscreen()}>⛶ Tela cheia</button>
            <button type="button" onClick={onClose}>× Fechar</button>
          </div>
        </header>
        <div className="media-player-surface">
          <video
            ref={videoRef}
            controls
            playsInline
            crossOrigin={directHttp ? undefined : 'anonymous'}
            onCanPlay={() => setLoading(false)}
            onPlaying={() => { setLoading(false); setNeedsPlay(false); }}
            onWaiting={() => setLoading(true)}
            onError={() => {
              setLoading(false);
              setPlayerError('Não foi possível reproduzir esta mídia neste navegador.');
            }}
          />
          {loading && !playerError && <div className="media-player-status"><Spinner /> Preparando mídia…</div>}
          {needsPlay && !playerError && (
            <button type="button" className="media-player-start" onClick={resumePlayback}>▶ REPRODUZIR</button>
          )}
          {playerError && <div className="media-player-error">{playerError}</div>}
        </div>
      </section>
    </div>
  );
}

function Header({
  profileName: currentProfile,
  onManageProfiles,
  onLogout,
}: {
  profileName: string;
  onManageProfiles?: () => void;
  onLogout(): void;
}) {
  return (
    <header className="topbar">
      <img className="topbar-logo" src={assetUrl('images/logo_evotv.png')} alt="EVOTV" />
      <div className="topbar-actions">
        {currentProfile && <span className="profile-pill">{currentProfile}</span>}
        {onManageProfiles && <button className="button button-ghost compact" onClick={onManageProfiles}>Gerenciar perfis</button>}
        <button className="button button-ghost compact" onClick={onLogout}>
          Sair
        </button>
      </div>
    </header>
  );
}

function LoginScreen({
  login,
  password,
  remember,
  busy,
  error,
  onLogin,
  onPassword,
  onRemember,
  onSubmit,
  onOpenInstallGuide,
}: {
  login: string;
  password: string;
  remember: boolean;
  busy: boolean;
  error: string;
  onLogin(value: string): void;
  onPassword(value: string): void;
  onRemember(value: boolean): void;
  onSubmit(event: FormEvent): void;
  onOpenInstallGuide(): void;
}) {
  return (
    <section className="login-layout">
      <form className="login-card" onSubmit={onSubmit}>
        <img className="login-logo" src={assetUrl('images/logo_evotv.png')} alt="EVOTV" />
        <div className="login-heading">
          <span className="eyebrow">BEM-VINDO</span>
          <h2>Entre na sua conta</h2>
        </div>
        <label className="field">
          <span>Login</span>
          <input
            autoComplete="username"
            inputMode="text"
            value={login}
            disabled={busy}
            onChange={(event) => onLogin(event.target.value)}
            placeholder="Digite seu login"
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            disabled={busy}
            onChange={(event) => onPassword(event.target.value)}
            placeholder="Digite sua senha"
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={remember}
            disabled={busy}
            onChange={(event) => onRemember(event.target.checked)}
          />
          <span>Lembrar meu login neste aparelho</span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="button button-primary button-large" disabled={busy}>
          {busy ? <Spinner /> : 'CONTINUAR'}
        </button>
        <button type="button" className="install-link" onClick={onOpenInstallGuide}>
          Guia de Instalação
        </button>
        <small className="security-note">
          A senha não é armazenada no navegador.
        </small>
      </form>
    </section>
  );
}

function ProfilesScreen({ account, busy, error, onSelect }: {
  account: Account;
  busy: boolean;
  error: string;
  onSelect(profile: number): void;
}) {
  return (
    <section className="page-section centered-section">
      <span className="eyebrow">{account.accountType}</span>
      <h1 className="page-title">Quem está assistindo?</h1>
      <p className="page-subtitle">Escolha um perfil para abrir sua programação.</p>
      {error && <Notice tone="error">{error}</Notice>}
      {busy && <div className="loading-line"><Spinner /> Abrindo perfil…</div>}
      <div className="profile-grid">
        {Array.from({ length: account.screens }, (_, index) => (
          <button
            key={index}
            className="profile-card"
            disabled={busy}
            onClick={() => onSelect(index + 1)}
          >
            <span className="profile-avatar">{index + 1}</span>
            <strong>{profileName(account, index)}</strong>
            <small>Assistir agora</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProfilePinDialog({ profileName: name, pin, busy, error, onPin, onSubmit, onClose }: {
  profileName: string;
  pin: string;
  busy: boolean;
  error: string;
  onPin(value: string): void;
  onSubmit(event: FormEvent): void;
  onClose(): void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="install-modal profile-pin-modal" role="dialog" aria-modal="true" aria-labelledby="profile-pin-title" onSubmit={onSubmit}>
        <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose} disabled={busy}>×</button>
        <span className="eyebrow">PERFIL PROTEGIDO</span>
        <h2 id="profile-pin-title">Entrar em {name}</h2>
        <p>Digite o PIN definido pelo perfil principal.</p>
        <label className="field">
          <span>PIN DO PERFIL</span>
          <input autoFocus autoComplete="off" type="password" value={pin} maxLength={128} disabled={busy} onChange={(event) => onPin(event.target.value)} />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="button button-primary button-large" disabled={busy}>{busy ? <Spinner /> : 'ENTRAR NO PERFIL'}</button>
      </form>
    </div>
  );
}

function ProfileSettingsDialog({ settings, busy, error, onChange, onSubmit, onClose }: {
  settings: ProfileSettings;
  busy: boolean;
  error: string;
  onChange(settings: ProfileSettings): void;
  onSubmit(event: FormEvent): void;
  onClose(): void;
}) {
  const update = (index: number, field: 'name' | 'pin', value: string) => onChange({
    ...settings,
    profiles: settings.profiles.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
  });
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="install-modal profile-settings-modal" role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" onSubmit={onSubmit}>
        <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose} disabled={busy}>×</button>
        <span className="eyebrow">PERFIL PRINCIPAL</span>
        <h2 id="profile-settings-title">Gerenciar perfis</h2>
        <p>Altere os nomes e informe um novo PIN apenas quando desejar substituí-lo.</p>
        <div className="profile-settings-list">
          {settings.profiles.map((item, index) => <div className="profile-settings-row" key={item.profile}>
            <strong>{item.profile}</strong>
            <label className="field"><span>Nome</span><input value={item.name} maxLength={60} disabled={busy} onChange={(event) => update(index, 'name', event.target.value)} /></label>
            <label className="field"><span>Novo PIN · opcional</span><input type="password" autoComplete="new-password" value={item.pin || ''} maxLength={128} disabled={busy} onChange={(event) => update(index, 'pin', event.target.value)} /></label>
          </div>)}
        </div>
        <small className="security-note">PINs em branco permanecem inalterados. Use de 4 a 128 caracteres.</small>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="button button-primary button-large" disabled={busy}>{busy ? <Spinner /> : 'SALVAR PERFIS'}</button>
      </form>
    </div>
  );
}

function CatalogScreen({
  kind,
  categories,
  selectedCategory,
  searchQuery,
  catalog,
  total,
  hasMore,
  loadingMore,
  busy,
  error,
  onBack,
  onChangeKind,
  onChangeCategory,
  onSearch,
  onLoadMore,
  onOpen,
}: {
  kind: MediaKind;
  categories: CatalogCategory[];
  selectedCategory: string;
  searchQuery: string;
  catalog: CatalogItem[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  busy: boolean;
  error: string;
  onBack(): void;
  onChangeKind(kind: MediaKind): void;
  onChangeCategory(category: string): void;
  onSearch(query: string): void;
  onLoadMore(): void;
  onOpen(item: CatalogItem): void;
}) {
  const [searchText, setSearchText] = useState(searchQuery);
  const loadMoreTarget = useRef<HTMLDivElement>(null);
  const visibleCategories = useMemo(() => {
    const primary = primaryCategories[kind];
    const configuredPrimary = categories.find((category) => category.id === primary.id);
    return [
      configuredPrimary ?? primary,
      { id: 'all', name: 'Todos' },
      ...categories.filter(
        (category) => category.id !== primary.id && category.id !== 'all',
      ),
    ];
  }, [categories, kind]);

  useEffect(() => setSearchText(searchQuery), [kind, searchQuery]);

  useEffect(() => {
    const target = loadMoreTarget.current;
    if (!target || !hasMore || busy || loadingMore || !('IntersectionObserver' in window)) {
      return;
    }
    let requested = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || requested) return;
        requested = true;
        onLoadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [busy, hasMore, loadingMore, onLoadMore]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    onSearch(searchText);
  }

  return (
    <section className="page-section catalog-section">
      <div className="section-heading">
        <div>
          <button className="back-link" onClick={onBack} disabled={busy}>← Trocar perfil</button>
          <h1 className="page-title">Sua programação</h1>
        </div>
        <div className="media-tabs" role="tablist" aria-label="Tipo de conteúdo">
          {mediaKinds.map((entry) => (
            <button
              key={entry}
              role="tab"
              aria-selected={entry === kind}
              className={entry === kind ? 'media-tab active' : 'media-tab'}
              disabled={busy}
              onClick={() => onChangeKind(entry)}
            >
              {mediaLabels[entry]}
            </button>
          ))}
        </div>
      </div>

      <div className="catalog-tools">
        <form className="catalog-search" role="search" onSubmit={submitSearch}>
          <label htmlFor="catalog-search-input" className="sr-only">Pesquisar mídias</label>
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            id="catalog-search-input"
            type="search"
            value={searchText}
            maxLength={100}
            placeholder={`Pesquisar ${mediaLabels[kind].toLowerCase()}...`}
            disabled={busy}
            onChange={(event) => setSearchText(event.currentTarget.value)}
          />
          {(searchText || searchQuery) && (
            <button
              type="button"
              className="clear-search"
              disabled={busy}
              onClick={() => {
                setSearchText('');
                onSearch('');
              }}
              aria-label="Limpar pesquisa"
            >
              ×
            </button>
          )}
          <button type="submit" className="button button-primary search-button" disabled={busy}>
            Pesquisar mídias
          </button>
        </form>
        <div className="catalog-summary" aria-live="polite">
          {busy && !catalog.length
            ? 'Carregando catálogo…'
            : `${catalog.length} de ${total} ${total === 1 ? 'item' : 'itens'}`}
        </div>
      </div>

      <div className="category-strip" aria-label="Categorias">
        {visibleCategories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={category.id === selectedCategory ? 'category-chip active' : 'category-chip'}
            aria-pressed={category.id === selectedCategory}
            disabled={busy}
            onClick={() => onChangeCategory(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {busy && !catalog.length ? (
        <div className="catalog-loading"><Spinner /> Carregando {mediaLabels[kind].toLowerCase()}…</div>
      ) : catalog.length ? (
        <>
          <div className="catalog-grid">
            {catalog.map((item) => (
              <button
                key={`${item.kind}-${item.id}`}
                className="catalog-card"
                disabled={busy}
                onClick={() => onOpen(item)}
              >
                <Poster item={item} />
                <span className="catalog-card-copy">
                  <strong>{item.name}</strong>
                  <small>{item.kind === 'live' ? 'AO VIVO' : mediaLabels[item.kind]}</small>
                </span>
              </button>
            ))}
          </div>
          {hasMore && (
            <div ref={loadMoreTarget} className="load-more-row">
              <button
                type="button"
                className="button button-ghost load-more-button"
                disabled={busy || loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? <><Spinner /> Carregando mais…</> : 'Carregar mais mídias'}
              </button>
            </div>
          )}
        </>
      ) : (
        <EmptyState>
          {searchQuery
            ? `Nenhum resultado para “${searchQuery}”.`
            : `Nenhum conteúdo encontrado em ${mediaLabels[kind]}.`}
        </EmptyState>
      )}
    </section>
  );
}

function Poster({ item }: { item: CatalogItem }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="poster">
      {!failed && item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="poster-placeholder">{item.name.slice(0, 1).toUpperCase()}</span>
      )}
      {item.kind === 'live' && <span className="live-badge">AO VIVO</span>}
    </span>
  );
}

function SeriesScreen({
  item,
  details,
  busy,
  error,
  onBack,
  onRetry,
  onPlay,
}: {
  item: CatalogItem;
  details: SeriesDetails | null;
  busy: boolean;
  error: string;
  onBack(): void;
  onRetry(): void;
  onPlay(episode: SeriesEpisode): void;
}) {
  return (
    <section className="page-section series-section">
      <button className="back-link" onClick={onBack}>← Voltar ao catálogo</button>
      {busy && !details ? (
        <div className="catalog-loading"><Spinner /> Carregando episódios…</div>
      ) : error && !details ? (
        <EmptyState>
          <p>{error}</p>
          <button className="button button-primary" onClick={onRetry}>Tentar novamente</button>
        </EmptyState>
      ) : details ? (
        <>
          <div className="series-hero">
            <div className="series-cover">
              {details.coverUrl ? <img src={details.coverUrl} alt="" /> : <span>{item.name.slice(0, 1)}</span>}
            </div>
            <div className="series-copy">
              <span className="eyebrow">SÉRIE</span>
              <h1>{details.title}</h1>
              {details.plot && <p>{details.plot}</p>}
            </div>
          </div>
          <div className="seasons-list">
            {details.seasons.length ? details.seasons.map((season, index) => (
              <details className="season-card" key={season.number} open={index === 0}>
                <summary>
                  <strong>{season.number > 0 ? `Temporada ${season.number}` : 'Especiais'}</strong>
                  <span>{season.episodes.length} episódios</span>
                </summary>
                <div className="episode-list">
                  {season.episodes.map((episode) => (
                    <button className="episode-row" key={episode.id} onClick={() => onPlay(episode)}>
                      <span className="episode-number">{episode.number}</span>
                      <span className="episode-copy">
                        <strong>{episode.title}</strong>
                        {episode.duration && <small>{durationLabel(episode.duration)}</small>}
                      </span>
                      <span className="play-symbol">▶</span>
                    </button>
                  ))}
                </div>
              </details>
            )) : <EmptyState>Nenhum episódio disponível para esta série.</EmptyState>}
          </div>
        </>
      ) : null}
    </section>
  );
}

function InstallHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
      >
        <button type="button" className="modal-close" aria-label="Fechar guia de instalação" onClick={onClose}>×</button>
        <img src={assetUrl('icons/icon-192.png')} alt="" className="install-icon" />
        <span className="eyebrow">EVOTV PWA</span>
        <h2 id="install-title">GUIA DE INSTALAÇÃO</h2>
        <p className="install-audience">
          Escolha as instruções do seu dispositivo. Este guia não abre o
          compartilhamento nem inicia uma instalação automaticamente.
        </p>
        <div className="install-steps">
          <section className="install-step-group">
            <h3>Chrome no Android</h3>
            <ol>
              <li>Abra esta página no Google Chrome.</li>
              <li>Toque no menu <strong>⋮</strong>.</li>
              <li>Toque em <strong>Adicionar à tela inicial</strong> ou <strong>Instalar app</strong>.</li>
              <li>Confirme em <strong>Instalar</strong>.</li>
            </ol>
          </section>
          <section className="install-step-group">
            <h3>Chrome no computador</h3>
            <ol>
              <li>Abra o menu <strong>⋮</strong>.</li>
              <li>Acesse <strong>Transmitir, guardar e partilhar</strong>.</li>
              <li>Escolha <strong>Instalar EVOTV</strong> e confirme.</li>
            </ol>
            <small>Use a opção “Instalar”, não “Criar atalho”, para abrir como aplicativo.</small>
          </section>
          <section className="install-step-group">
            <h3>Safari no iPhone ou iPad</h3>
            <ol>
              <li>Abra esta página no Safari.</li>
              <li>Toque em <strong>Compartilhar</strong>.</li>
              <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
              <li>Confirme em <strong>Adicionar</strong>.</li>
            </ol>
          </section>
        </div>
      </section>
    </div>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone: 'error' }) {
  return <div className={`notice ${tone}`}>{children}</div>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function Spinner() {
  return <span className="spinner" aria-label="Carregando" />;
}

function readableError(reason: unknown): string {
  if (reason instanceof EvoApiError || reason instanceof Error) return reason.message;
  return 'Não foi possível concluir a operação.';
}

function mediaProxyErrorMessage(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const value = JSON.parse(raw) as { error?: unknown };
    return typeof value.error === 'string' ? value.error : '';
  } catch {
    return '';
  }
}

function durationLabel(raw: string): string {
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds)) return raw;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

function isStandalone(): boolean {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function shouldShowInstallHelpFromRedirect(): boolean {
  return (
    !isStandalone() &&
    new URLSearchParams(window.location.search).get('install') === '1'
  );
}

function useTvSpatialNavigation() {
  useEffect(() => {
    const selector = [
      'button:not(:disabled)',
      'input:not(:disabled)',
      'summary',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }

      const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter(isVisibleFocusable);
      if (!candidates.length) return;

      if (!active || !candidates.includes(active)) {
        candidates[0].focus();
        event.preventDefault();
        return;
      }

      const origin = rectCenter(active.getBoundingClientRect());
      const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      const sign = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
      let best: { element: HTMLElement; score: number } | null = null;

      for (const candidate of candidates) {
        if (candidate === active) continue;
        const target = rectCenter(candidate.getBoundingClientRect());
        const primary = vertical ? target.y - origin.y : target.x - origin.x;
        if (Math.sign(primary) !== sign || Math.abs(primary) < 2) continue;
        const secondary = vertical ? target.x - origin.x : target.y - origin.y;
        const score = Math.abs(primary) + Math.abs(secondary) * 2.2;
        if (!best || score < best.score) best = { element: candidate, score };
      }

      if (best) {
        best.element.focus({ preventScroll: true });
        best.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function isVisibleFocusable(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none'
  );
}

function rectCenter(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { EvoApi, EvoApiError } from './api';
import { clearSavedLogin, loadSavedLogin, saveLogin } from './storage';
import {
  type Account,
  type AuthSession,
  type CatalogItem,
  type MediaKind,
  type ProfileSession,
  type SeriesDetails,
  type SeriesEpisode,
  episodeAsCatalogItem,
  mediaKinds,
  mediaLabels,
  profileName,
} from './types';

type Screen = 'login' | 'profiles' | 'catalog' | 'series' | 'player';

interface PlayerState {
  item: CatalogItem;
  source: string;
  returnTo: 'catalog' | 'series';
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const api = new EvoApi();
const isPwaPath = /\/pwa(?:\/|$)/.test(window.location.pathname);
const assetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${isPwaPath ? '../' : ''}${path}`;
const INSTALL_HELP_DISMISSED = 'evotv_install_help_dismissed';
const ANDROID_DOWNLOAD_URL =
  'https://github.com/evotechubdev/evodec/releases/download/v1.0.6/EVOTV.Android.1.0.6.apk';
const WINDOWS_DOWNLOAD_URL =
  'https://github.com/evotechubdev/evodec/releases/download/v1.0.6/programa.de.PC.EVOTV.Setup.0.0.2.exe';
const PUBLIC_CONTACTS_URL =
  'https://firestore.googleapis.com/v1/projects/multimideas-evotv/databases/(default)/documents/public/contatos';

interface PublicContacts {
  support: string;
  commercial: string;
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
              version="1.0.6"
              description="Para celulares, tablets, TV Box e Smart TVs com Android."
              href={ANDROID_DOWNLOAD_URL}
              label="Baixar APK"
            />
            <DownloadCard
              icon="windows"
              title="EVOTV - PC Windows"
              version="0.2"
              description="Aplicativo completo para computadores e notebooks Windows."
              href={WINDOWS_DOWNLOAD_URL}
              label="Baixar para Windows"
            />
            <DownloadCard
              icon="pwa"
              title="EVOTV - PWA"
              version="1.0.6"
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
  version: string;
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
        <strong>{title} <small>(versão: {version})</small></strong>
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
  const [selectedKind, setSelectedKind] = useState<MediaKind>('live');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [seriesItem, setSeriesItem] = useState<CatalogItem | null>(null);
  const [seriesDetails, setSeriesDetails] = useState<SeriesDetails | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(
    shouldShowInstallHelpFromRedirect,
  );
  const [installPreparationEndsAt, setInstallPreparationEndsAt] =
    useState<number | null>(null);
  const [installPreparationSeconds, setInstallPreparationSeconds] =
    useState<number | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const profileSelectionInFlight = useRef(false);

  useTvSpatialNavigation();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('install') !== '1') return;
    url.searchParams.delete('install');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallPreparationEndsAt(null);
      setInstallPreparationSeconds(null);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      closeInstallHelp();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (installPreparationEndsAt === null || installPrompt) return;
    const updateCountdown = () => {
      setInstallPreparationSeconds(
        Math.max(0, Math.ceil((installPreparationEndsAt - Date.now()) / 1000)),
      );
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [installPreparationEndsAt, installPrompt]);

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

  async function chooseProfile(profile: number) {
    if (!auth || busy || profileSelectionInFlight.current) return;
    profileSelectionInFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const nextSession = await api.selectProfile(auth.idToken, profile);
      const page = await api.catalog(
        auth.idToken,
        nextSession.sessionToken,
        profile,
        'live',
      );
      setProfileSession(nextSession);
      setSelectedProfile(profile);
      setSelectedKind('live');
      setCatalog(page.items);
      setScreen('catalog');
    } catch (reason) {
      setProfileSession(null);
      setSelectedProfile(0);
      setError(readableError(reason));
    } finally {
      profileSelectionInFlight.current = false;
      setBusy(false);
    }
  }

  async function changeKind(kind: MediaKind) {
    if (!auth || !profileSession || busy || kind === selectedKind) return;
    setSelectedKind(kind);
    setCatalog([]);
    setBusy(true);
    setError('');
    try {
      const page = await api.catalog(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        kind,
      );
      setCatalog(page.items);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
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

  async function playItem(item: CatalogItem, returnTo: 'catalog' | 'series') {
    if (!auth || !profileSession || busy) return;
    setBusy(true);
    setError('');
    try {
      const source = await api.playbackSource(
        auth.idToken,
        profileSession.sessionToken,
        selectedProfile,
        item,
      );
      setPlayer({
        item,
        source,
        returnTo,
      });
      setScreen('player');
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
    setSelectedProfile(0);
    setCatalog([]);
    setSeriesItem(null);
    setSeriesDetails(null);
    setPlayer(null);
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

  async function requestInstall() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === 'accepted') setShowInstallHelp(false);
      return;
    }
    setShowInstallHelp(true);
    if (isChromeBrowser() && !isIosDevice()) {
      setInstallPreparationEndsAt(Date.now() + 32_000);
      setInstallPreparationSeconds(32);
    }
  }

  function closeInstallHelp() {
    try {
      sessionStorage.setItem(INSTALL_HELP_DISMISSED, '1');
    } catch {
      // O assistente ainda pode ser fechado quando o armazenamento está bloqueado.
    }
    setInstallPreparationEndsAt(null);
    setInstallPreparationSeconds(null);
    setShowInstallHelp(false);
  }

  function reloadForInstall() {
    const url = new URL(window.location.href);
    url.searchParams.set('install', '1');
    window.location.assign(url.href);
  }

  function endProfileSession(message: string) {
    setError(message);
    setPlayer(null);
    setProfileSession(null);
    setSelectedProfile(0);
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
          canInstall={!installed}
          onInstall={requestInstall}
          onLogout={logout}
        />
      )}

      <main className={screen === 'player' ? 'main-player' : 'main-content'}>
        {screen === 'login' && (
          <LoginScreen
            login={login}
            password={password}
            remember={remember}
            busy={busy}
            error={error}
            installed={installed}
            onLogin={setLogin}
            onPassword={setPassword}
            onRemember={(checked) => {
              setRemember(checked);
              if (!checked) clearSavedLogin();
            }}
            onSubmit={signIn}
            onInstall={requestInstall}
          />
        )}

        {screen === 'profiles' && account && (
          <ProfilesScreen
            account={account}
            busy={busy}
            error={error}
            onSelect={chooseProfile}
          />
        )}

        {screen === 'catalog' && (
          <CatalogScreen
            kind={selectedKind}
            catalog={catalog}
            busy={busy}
            error={error}
            onBack={backToProfiles}
            onChangeKind={changeKind}
            onOpen={(item) =>
              item.kind === 'series'
                ? void openSeries(item)
                : void playItem(item, 'catalog')
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
                'series',
              )
            }
          />
        )}

        {screen === 'player' && player && (
          <PlayerScreen
            player={player}
            onBack={() => {
              setError('');
              setScreen(player.returnTo);
              setPlayer(null);
            }}
            onSessionEnded={endProfileSession}
          />
        )}
      </main>

      {showInstallHelp && (
        <InstallHelp
          canPrompt={Boolean(installPrompt)}
          preparationSeconds={installPreparationSeconds}
          onInstall={requestInstall}
          onReload={reloadForInstall}
          onClose={closeInstallHelp}
        />
      )}
    </div>
  );
}

function Header({
  profileName: currentProfile,
  canInstall,
  onInstall,
  onLogout,
}: {
  profileName: string;
  canInstall: boolean;
  onInstall(): void;
  onLogout(): void;
}) {
  return (
    <header className="topbar">
      <img className="topbar-logo" src={assetUrl('images/logo_evotv.png')} alt="EVOTV" />
      <div className="topbar-actions">
        {currentProfile && <span className="profile-pill">{currentProfile}</span>}
        {canInstall && (
          <button className="button button-ghost compact" onClick={onInstall}>
            Instalar
          </button>
        )}
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
  installed,
  onLogin,
  onPassword,
  onRemember,
  onSubmit,
  onInstall,
}: {
  login: string;
  password: string;
  remember: boolean;
  busy: boolean;
  error: string;
  installed: boolean;
  onLogin(value: string): void;
  onPassword(value: string): void;
  onRemember(value: boolean): void;
  onSubmit(event: FormEvent): void;
  onInstall(): void;
}) {
  const [showPassword, setShowPassword] = useState(false);
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
          <div className="password-field">
            <input
              autoComplete="current-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              disabled={busy}
              onChange={(event) => onPassword(event.target.value)}
              placeholder="Digite sua senha"
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
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
        {!installed && (
          <button type="button" className="install-link" onClick={onInstall}>
            Instalar o EVOTV na tela inicial
          </button>
        )}
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

function CatalogScreen({
  kind,
  catalog,
  busy,
  error,
  onBack,
  onChangeKind,
  onOpen,
}: {
  kind: MediaKind;
  catalog: CatalogItem[];
  busy: boolean;
  error: string;
  onBack(): void;
  onChangeKind(kind: MediaKind): void;
  onOpen(item: CatalogItem): void;
}) {
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
      {error && <Notice tone="error">{error}</Notice>}
      {busy ? (
        <div className="catalog-loading"><Spinner /> Carregando {mediaLabels[kind].toLowerCase()}…</div>
      ) : catalog.length ? (
        <div className="catalog-grid">
          {catalog.map((item) => (
            <button
              key={`${item.kind}-${item.id}`}
              className="catalog-card"
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
      ) : (
        <EmptyState>Nenhum conteúdo encontrado em {mediaLabels[kind]}.</EmptyState>
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

function PlayerScreen({
  player,
  onBack,
  onSessionEnded,
}: {
  player: PlayerState;
  onBack(): void;
  onSessionEnded(message: string): void;
}) {
  const [failure, setFailure] = useState('');
  return (
    <section className="player-screen">
      <div className="player-toolbar">
        <button className="back-link" onClick={onBack}>← Voltar</button>
        <strong>{player.item.name}</strong>
        {player.item.kind === 'live' && <span className="live-badge static">AO VIVO</span>}
      </div>
      <div className="video-stage">
        {failure ? (
          <EmptyState>
            <p>Não foi possível reproduzir este conteúdo no navegador.</p>
            <small>{failure}</small>
            <small>A mídia já é acessada pelo proxy HTTPS; este aviso não é um bloqueio de conteúdo HTTP misto.</small>
            <button className="button button-primary" onClick={onBack}>Voltar</button>
          </EmptyState>
        ) : (
          <video
            key={player.source}
            src={player.source}
            controls
            autoPlay
            playsInline
            onError={(event) => {
              const fallback = browserMediaError(event.currentTarget.error);
              setFailure(fallback);
              void inspectPlaybackFailure(player.source, fallback).then((result) => {
                setFailure(result.message);
                if (result.status === 409) onSessionEnded(result.message);
              });
            }}
          />
        )}
      </div>
    </section>
  );
}

function browserMediaError(error: MediaError | null): string {
  if (error?.code === MediaError.MEDIA_ERR_NETWORK) {
    return 'A conexão com o servidor de mídia foi interrompida.';
  }
  if (error?.code === MediaError.MEDIA_ERR_DECODE) {
    return 'O navegador não conseguiu decodificar o formato ou codec deste vídeo.';
  }
  if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return 'O navegador não reconheceu o formato ou codec entregue pelo servidor.';
  }
  return 'O servidor de mídia não conseguiu iniciar a reprodução.';
}

async function inspectPlaybackFailure(
  source: string,
  fallback: string,
): Promise<{ message: string; status?: number }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(source, { signal: controller.signal });
    if (response.ok) {
      await response.body?.cancel();
      return { message: fallback };
    }
    const body = await response.text();
    try {
      const data = JSON.parse(body) as { error?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) {
        return { message: data.error, status: response.status };
      }
    } catch {
      // Respostas não JSON usam a mensagem segura abaixo.
    }
    return {
      message: `O proxy de mídia respondeu com HTTP ${response.status}.`,
      status: response.status,
    };
  } catch {
    return { message: 'Não foi possível conectar ao proxy HTTPS de mídia.' };
  } finally {
    window.clearTimeout(timeout);
  }
}

function InstallHelp({
  canPrompt,
  preparationSeconds,
  onInstall,
  onReload,
  onClose,
}: {
  canPrompt: boolean;
  preparationSeconds: number | null;
  onInstall(): void;
  onReload(): void;
  onClose(): void;
}) {
  const ios = isIosDevice();
  const chrome = isChromeBrowser();
  const [guide, setGuide] = useState<'chrome' | 'safari'>(
    ios ? 'safari' : 'chrome',
  );
  const nativeInstallReady = guide === 'chrome' && canPrompt;
  const chromeAvailable = guide === 'chrome' && chrome && !ios;
  const preparing = chromeAvailable && preparationSeconds !== null;
  const preparationExpired = preparing && preparationSeconds === 0;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" aria-label="Fechar" onClick={onClose}>×</button>
        <img src={assetUrl('icons/icon-192.png')} alt="" className="install-icon" />
        <span className="eyebrow">EVOTV PWA</span>
        <h2 id="install-title">INSTALAR AGORA</h2>
        <p className="install-audience">
          Opção indicada para iOS e outros sistemas de TV ou dispositivos onde
          os aplicativos Android e Windows não estão disponíveis.
        </p>
        <div className="install-guide-tabs" role="tablist" aria-label="Escolha o navegador">
          <button
            type="button"
            role="tab"
            aria-selected={guide === 'chrome'}
            className={guide === 'chrome' ? 'install-guide-tab active' : 'install-guide-tab'}
            onClick={() => setGuide('chrome')}
          >
            Chrome
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={guide === 'safari'}
            className={guide === 'safari' ? 'install-guide-tab active' : 'install-guide-tab'}
            onClick={() => setGuide('safari')}
          >
            Safari / iPhone
          </button>
        </div>
        {nativeInstallReady ? (
          <p>
            Este navegador pode instalar o EVOTV como aplicativo. Confirme na
            próxima janela para adicioná-lo ao dispositivo.
          </p>
        ) : guide === 'safari' ? (
          <p>
            No iPhone ou iPad, abra no Safari e toque em <strong>Compartilhar</strong> → <strong>Adicionar à Tela de Início</strong>. No Mac, use <strong>Arquivo</strong> → <strong>Adicionar ao Dock</strong>.
          </p>
        ) : !chromeAvailable ? (
          <p>
            {ios
              ? <>No iPhone ou iPad, o Chrome não oferece instalação PWA nativa. Escolha <strong>Safari / iPhone</strong> acima.</>
              : <>Abra este mesmo endereço no Google Chrome para preparar a instalação como aplicativo.</>}
          </p>
        ) : (
          <p>
            {preparationExpired
              ? <>O Chrome concluiu o tempo de preparação. Toque em <strong>Atualizar para instalar</strong> para verificar novamente.</>
              : preparing
                ? <>O Chrome está preparando a instalação. Mantenha esta página aberta; o botão mudará para <strong>Instalar</strong> quando estiver pronto.</>
                : <>Toque em <strong>Preparar instalação</strong> e mantenha esta página aberta por alguns segundos.</>}
          </p>
        )}
        {nativeInstallReady ? (
          <button className="button button-primary button-large" onClick={onInstall}>
            Instalar
          </button>
        ) : guide === 'safari' || !chromeAvailable ? (
          <button className="button button-primary button-large" onClick={onClose}>
            Fechar
          </button>
        ) : preparationExpired ? (
          <button className="button button-primary button-large" onClick={onReload}>
            Atualizar para instalar
          </button>
        ) : preparing ? (
          <button className="button button-primary button-large" disabled>
            <Spinner /> Preparando… {preparationSeconds}s
          </button>
        ) : (
          <button className="button button-primary button-large" onClick={onInstall}>
            Preparar instalação
          </button>
        )}
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

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isChromeBrowser(): boolean {
  return (
    /Chrome|CriOS/i.test(navigator.userAgent) &&
    !/Edg|OPR|SamsungBrowser/i.test(navigator.userAgent)
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

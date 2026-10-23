const LOGIN_KEY = 'evo_pwa_login_v1';

export function loadSavedLogin(): string {
  try {
    return localStorage.getItem(LOGIN_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveLogin(login: string): void {
  try {
    localStorage.setItem(LOGIN_KEY, login.trim().toLowerCase());
  } catch {
    // O modo privado pode impedir armazenamento; o login continua funcionando.
  }
}

export function clearSavedLogin(): void {
  try {
    localStorage.removeItem(LOGIN_KEY);
  } catch {
    // Limpeza de melhor esforço.
  }
}

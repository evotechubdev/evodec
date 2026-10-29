import {
  clearProfilePins,
  clearRememberedAuth,
  readProfilePin,
  readRememberedAuth,
  saveProfilePin,
  saveRememberedAuth,
} from './device-vault.js';

try {
  await saveRememberedAuth({ login: 'vault-test', refreshToken: 'refresh-test' });
  await saveProfilePin('vault-test', 1, '4321');
  const auth = await readRememberedAuth();
  const pin = await readProfilePin('vault-test', 1);
  if (auth?.login !== 'vault-test' || auth?.refreshToken !== 'refresh-test' || pin !== '4321') throw new Error('READ_FAILED');
  await clearRememberedAuth();
  await clearProfilePins('vault-test');
  const clearedAuth = await readRememberedAuth();
  const clearedPin = await readProfilePin('vault-test', 1);
  if (clearedAuth || clearedPin) throw new Error('CLEAR_FAILED');
  document.body.dataset.result = 'PASS';
} catch (error) {
  document.body.dataset.result = `FAIL:${error?.message || error}`;
}

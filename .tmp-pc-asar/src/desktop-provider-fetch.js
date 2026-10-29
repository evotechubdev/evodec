function createSecureFetch(validateTarget, { fetchImpl = fetch, headerTimeoutMs = 30_000 } = {}) {
  return async function secureFetch(rawUrl, options = {}, redirects = 0, allowProviderCdn = false) {
    const url = await validateTarget(rawUrl, allowProviderCdn || redirects > 0);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), headerTimeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(url, {
        ...options, redirect: 'manual',
        signal: options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal,
      });
    } finally {
      // Limit time to response headers, not the entire film/download.
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel();
      if (redirects >= 4) throw new Error('Muitos redirecionamentos do provedor.');
      const next = new URL(response.headers.get('location'), url).href;
      // Only provider-supplied redirects may use a CDN outside the configured
      // origin. validateTarget still rejects private networks and non-HTTP URLs.
      return secureFetch(next, options, redirects + 1, true);
    }
    return response;
  };
}

module.exports = { createSecureFetch };

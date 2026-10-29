async function watchSession({ url, headers, signal, onEnded, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { headers, signal });
  if (response.status === 404) { await response.body?.cancel(); return false; }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
    await response.body?.cancel();
    throw new Error('Session events unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return true;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      if (buffer.length > 64 * 1024) throw new Error('Invalid session event');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = block.split('\n');
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        if (event !== 'session-ended') continue;
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        const payload = JSON.parse(data);
        onEnded(payload.message, payload.code);
        return false;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  return false;
}

module.exports = { watchSession };

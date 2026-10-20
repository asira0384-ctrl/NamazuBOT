import { TikTokLiveConnection, RouteConfig } from 'tiktok-live-connector';

export function parseHtml(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const script = scripts.find(m => /\bid\s*=\s*["']SIGI_STATE["']/i.test(m[1]));
  if (!script) throw new Error('HTMLに配信データがありません（TikTokのアクセス制限・CAPTCHAの可能性）');
  const data = JSON.parse(script[2]);
  const info = data?.LiveRoom?.liveRoomUserInfo;
  if (!info) throw new Error('HTMLのLiveRoomがありません');
  return info;
}
export function normalize(info, provider = false) {
  const raw = provider ? info : (info?.data || info);
  if (provider) {
    if (!info?.ok || Number(info.code) !== 200 || typeof info.is_live !== 'boolean')
      throw new Error('Euler: ' + (info?.message || 'API権限・応答を確認してください'));
    if (!info.is_live) return { live: false };
    if (!/^[1-9]\d+$/.test(String(info.room_id || ''))) throw new Error('Euler: 配信IDなし');
    return { live: true, room: String(info.room_id) };
  }
  const status = raw?.liveRoom?.status;
  // Unknown/missing/zero status is never treated as an offline confirmation.
  if (Number(status) === 4) return { live: false };
  if (Number(status) !== 2) throw new Error('判定できないstatus: ' + String(status));
  const room = raw?.user?.roomId || raw?.liveRoom?.id_str || raw?.liveRoom?.id;
  if (!/^[1-9]\d+$/.test(String(room || ''))) throw new Error('配信中ですが配信IDがありません');
  return { live: true, room: String(room) };
}
function bounded(task, ms) {
  let timer;
  return Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('応答待ちタイムアウト')), ms);
  })]).finally(() => clearTimeout(timer));
}
export async function probeSources(sources, timeout = 8500) {
  const details = Object.fromEntries(sources.map(([name]) => [name, '確認中']));
  const jobs = sources.map(([name, task]) => bounded(task, timeout).then(result => {
    details[name] = result.live ? '配信中 room=' + result.room : '未配信';
    return { ...result, source: name };
  }, e => { details[name] = String(e.message || e).slice(0, 220); throw e; }));
  try {
    // A slow/blocked source or an outdated offline response cannot delay another source's live result.
    const hit = await Promise.any(jobs.map(job => job.then(r => {
      if (!r.live) throw new Error('offline');
      return r;
    })));
    return { ...hit, details };
  } catch {
    const results = await Promise.allSettled(jobs);
    if (results.some(r => r.status === 'fulfilled' && !r.value.live))
      return { live: false, source: 'confirmed-offline', details };
    const error = new Error('全経路で検知失敗。/live debug で詳細を確認してください。');
    error.details = details; throw error;
  }
}
export async function resolveLive(user) {
  const connection = new TikTokLiveConnection(user, {
    ...(process.env.SIGN_API_KEY ? { signApiKey: process.env.SIGN_API_KEY } : {}),
    webClientOptions: { timeout: { request: 7500 }, retry: { limit: 0 } }
  });
  const args = { uniqueId: user, webClient: connection.webClient, apiClient: connection.apiClient };
  const sources = [
    ['TikTok HTML', async () => normalize(parseHtml(await connection.webClient.getHtmlFromTikTokWebsite('@' + user + '/live')))],
    ['TikTok API', async () => normalize(await RouteConfig.fetchRoomInfoFromApiLive(args))]
  ];
  if (process.env.SIGN_API_KEY)
    sources.push(['Euler', async () => normalize(await RouteConfig.fetchRoomIdFromProvider(args), true)]);
  return probeSources(sources);
}

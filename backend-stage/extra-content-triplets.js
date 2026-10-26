const COVER_URL = 'https://v-img.crazymaplestudios.com/v-images/book_cover_batch/404200150000007497/cbc4f2a7-a18a-4a77-9c00-afedb68ad114.jpg';
const SYNOPSIS = 'Elisa, uma garota meio humana e meio vampira, acredita que os trigêmeos Lockhart são os únicos em quem pode realmente confiar. Ela deseja se tornar humana por eles e passar a eternidade com um deles. Mas tudo muda quando Amber, a filha da empregada, surge. Repetidas vezes, Elisa é abandonada, humilhada e tem sua dignidade roubada. Tudo por Amber. Finalmente, ela decide aceitar seu destino: deixa a escola diurna, transfere-se para a noturna e se torna uma vampira. Quando Elisa reaparece ao lado de um poderoso herdeiro vampiro, os trigêmeos entram em pânico e passam a implorar por seu perdão.';

const STREAMS = Object.freeze([
  ['4:17', 'https://v-mps.crazymaplestudios.com/vod-112094/800b465dcb8071f18dbde6f6c55a0102/810f6aa7a98544d489915db31ddf672a-866b240b26aadb5d243509fc7153634d-ld.m3u8'],
  ['3:57', 'https://v-mps.crazymaplestudios.com/vod-112094/5071a13dcb8771f19bb6f7e7c57a0102/572b51913e08415ea5211427b24e44ad-bd01ed8b3a6d9c25f7c1c05dd74bd808-sd.m3u8'],
  ['2:15', 'https://v-mps.crazymaplestudios.com/vod-112094/f030df51cb8071f18626e7e7c7690102/de1c3b7febcf4a07ba09227264576d64-fed32110f2ea56bb8c3aa63918c74c6e-sd.m3u8'],
  ['1:55', 'https://v-mps.crazymaplestudios.com/vod-112094/f01f744bcb8071f19da6e6e7d77b0102/41705c2772b9479fa89683bfd6c86ddf-63f454ed92de5475cf73a881ef55558b-sd.m3u8'],
  ['2:00', 'https://v-mps.crazymaplestudios.com/vod-112094/d006804bcb8071f18626e7e7c7690102/710db653705c44cd86ece88381ca8401-eaf6e6f38f1279319efc47188ab60b6a-sd.m3u8'],
  ['3:04', 'https://v-mps.crazymaplestudios.com/vod-112094/40876557cb8071f18dbde6f6c55a0102/24c1274832134d92818aa7632975c012-ec8e72678611d8163ca09feaf6d541de-sd.m3u8'],
  ['3:25', 'https://v-mps.crazymaplestudios.com/vod-112094/107d8c51cb8071f19baff7e7c57a0102/f9d1b6d426bf4cfea5a39c351e77a368-310c5b38e12e3c8b77fac524f5b76970-sd.m3u8'],
  ['4:31', 'https://v-mps.crazymaplestudios.com/vod-112094/00f13f5dcb8071f19da7e6e7d77b0102/0ced54f1cdf44f6db161683ec36a6caf-64c2668fbca0d90cbaa8120e35004e7b-sd.m3u8'],
  ['1:56', 'https://v-mps.crazymaplestudios.com/vod-112094/b0d44546cb8071f18dbde6f6c55a0102/2251c5bd79af4548ba012d45ceceb363-e77e05c192c24b14a8cf9ce1dfc2b111-sd.m3u8'],
  ['2:14', 'https://v-mps.crazymaplestudios.com/vod-112094/30d16757cb8071f19da7e6e7d77b0102/307fc6b08b844b19a9b3b8baf642ac6d-f8eee19fb1e4c005f3a062b86d519600-sd.m3u8'],
  ['2:24', 'https://v-mps.crazymaplestudios.com/vod-112094/f04cfd3dcb8771f1b4c2e6f7e47a0102/6db732198d45425a9e7b0294d1f6f5c2-1091407be0e52b19b36053452ebcbfcb-sd.m3u8'],
  ['2:47', 'https://v-mps.crazymaplestudios.com/vod-112094/2036443dcb8771f19bb6f7e7c57a0102/79eda20df86a4fcfb7168a3c53e97d9b-455d1dc8aef38cdc389313415067cf8b-sd.m3u8'],
  ['2:16', 'https://v-mps.crazymaplestudios.com/vod-112094/60306651cb8071f1b637e7e7f57a0102/6f8af978953b4521b1a2a13a751e750d-01fad5593786d9a09e0b238b33c2bfc2-sd.m3u8'],
  ['2:11', 'https://v-mps.crazymaplestudios.com/vod-112094/f02587aecc6271f19e09e6e7d77b0102/bd63e6319a864a6b80f2a3db451f1b2f-485cbf88bc6a020c62266692ccc5d825-sd.m3u8'],
  ['2:54', 'https://v-mps.crazymaplestudios.com/vod-112094/a0e26857cb8071f19da7e6e7d77b0102/695777ab46844b83801e80de6cb72309-4abedff4ed5e0cd16120b9a3bfef14b9-sd.m3u8'],
  ['2:07', 'https://v-mps.crazymaplestudios.com/vod-112094/108f0652cb8071f18626e7e7c7690102/95befd212cef44249c66115d019ed05b-b68e2d4455055ca516338d1bd7e3c9d7-sd.m3u8'],
  ['1:17', 'https://v-mps.crazymaplestudios.com/vod-112094/5052b53ecb8771f18602f6f6d65a0102/7569b642e6c24ea5948c9f4e7ac5760c-85b1caf6cff29b201462c88c0635c4df-sd.m3u8'],
  ['1:55', 'https://v-mps.crazymaplestudios.com/vod-112094/f0125a3ecb8771f19bb6f7e7c57a0102/a82bc8f6af904fd7bd20bb6dc839c2da-0ad7809df74f045e34657aa1bd83234a-sd.m3u8'],
  ['2:22', 'https://v-mps.crazymaplestudios.com/vod-112094/50c68551cb8071f1b637e7e7f57a0102/d82ea6cd90e2434bb8e616ef1146fb7e-9ab585d93b20d87a99c3d4a8a149e3d8-sd.m3u8'],
  ['3:17', 'https://v-mps.crazymaplestudios.com/vod-112094/70a95e57cb8071f1b4bfe6f7e47a0102/da250086bb5247da9467a84324ddd2bd-19a403a7f9dd7fd445a9ee32c3c7e098-sd.m3u8'],
  ['2:26', 'https://v-mps.crazymaplestudios.com/vod-112094/9060514ccb8071f1a13ce6e7c64b0102/7cb4818bf8da44b38a80b3f39aeed1c5-bfa0463e1fe57a69d1d6e37299f80879-sd.m3u8'],
  ['1:16', 'https://v-mps.crazymaplestudios.com/vod-112094/e023524ccb8071f19baff7e7c57a0102/879301c0b96e4aa3a15d41c58e969c33-245959e7bf9db90f87e943ecb73ce868-sd.m3u8'],
  ['1:47', 'https://v-mps.crazymaplestudios.com/vod-112094/a0af7a4bcb8071f1b637e7e7f57a0102/f551e14afe614c91b372435d12c23191-7d1aa267e5d76019a1243b33760ac228-sd.m3u8'],
  ['1:41', 'https://v-mps.crazymaplestudios.com/vod-112094/60cf8a51cb8071f19da7e6e7d77b0102/e1a381a4042a49a685350f0494cfbaad-e8b6fd3e333b6cad86de3d67a33c4df6-sd.m3u8'],
  ['1:04', 'https://v-mps.crazymaplestudios.com/vod-112094/a0e1424ccb8071f18806f7e6c5580102/9c51d0f4e2194924a89e3d8198e356a4-5dcbcc157be92f0f1b4bce31c94d01b9-sd.m3u8'],
  ['1:34', 'https://v-mps.crazymaplestudios.com/vod-112094/90bc7751cb8071f18600f6f6d65a0102/8f7557c516fb462a80c41bf0b715d1b5-fe1c8553777407b6f67b467b5715b64b-sd.m3u8'],
  ['1:42', 'https://v-mps.crazymaplestudios.com/vod-112094/70a5d651cb8071f1a13de6e7c64b0102/ad0f5b5fde444d5898cbcf292c754ff5-669c9c64f5f9acd0c601eeec4bb7b255-sd.m3u8'],
  ['1:26', 'https://v-mps.crazymaplestudios.com/vod-112094/c0f79f45cb8071f18600f6f6d65a0102/82bf353ca50f48c0bfc98221026005ee-4ddf4042e33c35ffa8c44f31914e067e-sd.m3u8'],
  ['1:30', 'https://v-mps.crazymaplestudios.com/vod-112094/60545a52cb8071f19da7e6e7d77b0102/eff4015b644d4b9ba332103791dc3656-b7060421202ddf2e84d820adb29c9a44-sd.m3u8'],
  ['2:13', 'https://v-mps.crazymaplestudios.com/vod-112094/60328445cb8071f1a13ce6e7c64b0102/0f66876025924f208776414ca49746c2-71a6ca9638d61f391344e89e4e2e5bbb-sd.m3u8'],
  ['2:13', 'https://v-mps.crazymaplestudios.com/vod-112094/b09d1b52cb8071f19baff7e7c57a0102/d9b9e688021a431a89efcb2bdc29fc3e-79aa352f924b387d074dc6050abeeb20-sd.m3u8'],
  ['2:19', 'https://v-mps.crazymaplestudios.com/vod-112094/a06b8b51cb8071f18806f7e6c5580102/b84703c9d5f144e58993d1df90e7b824-21ccc2a0f126927e2c6b6575aefaef6a-sd.m3u8'],
  ['2:23', 'https://v-mps.crazymaplestudios.com/vod-112094/808e8d51cb8071f18dbde6f6c55a0102/b1f0f517af734dcd961725ff47edca89-fa3c7f083e5d8246c7527e4cd8525f1a-sd.m3u8'],
  ['2:18', 'https://v-mps.crazymaplestudios.com/vod-112094/80de5052cb8071f1a13de6e7c64b0102/b62c1491f868411783c079874caad9e6-79bfc56bfd77d2ac721c8074b58b2e14-sd.m3u8'],
  ['1:41', 'https://v-mps.crazymaplestudios.com/vod-112094/703b8945cb8071f19baff7e7c57a0102/1f9b6a10ea6f48fcaafeaf70b848483e-dd5e41f5e4b107565c6ba3a1c3aa4592-sd.m3u8'],
  ['1:17', 'https://v-mps.crazymaplestudios.com/vod-112094/60a2774bcb8071f1b636e7e7f57a0102/39aca6895df64a6da7f846831adafc05-6d9949b2b6d0db017b263b5237198c79-sd.m3u8'],
  ['1:52', 'https://v-mps.crazymaplestudios.com/vod-112094/0093914bcb8071f1a13ce6e7c64b0102/30be8aa3029e4a83bf58d2b40b9538b3-8311615bbbe766e8ce81720216dd817a-sd.m3u8'],
  ['1:55', 'https://v-mps.crazymaplestudios.com/vod-112094/10a48f45cb8071f18600f6f6d65a0102/f93b4be25dda4e2d9bf6f013b4bb7eb0-7f6f30c1ed0ff3a24b9095f33d6c75d8-sd.m3u8'],
  ['0:59', 'https://v-mps.crazymaplestudios.com/vod-112094/20ca804bcb8071f19baff7e7c57a0102/06948ec36e0340b8b3c2726e80797acc-92c51838b97d84b18f97d607d1d5f323-sd.m3u8'],
  ['0:47', 'https://v-mps.crazymaplestudios.com/vod-112094/a0886046cb8071f18600f6f6d65a0102/8c35e1abf188431ca59cba62da52a5cb-9130fe2eaab8cb02e3ae6502dde0200d-sd.m3u8'],
  ['1:30', 'https://v-mps.crazymaplestudios.com/vod-112094/00e3544ccb8071f18600f6f6d65a0102/3b3429deb8f447aabb24b70ba6d11bf5-7a27fded23accbac42c0f3e919034ea3-sd.m3u8'],
  ['1:08', 'https://v-mps.crazymaplestudios.com/vod-112094/60b87951cb8071f1b637e7e7f57a0102/319dbda1c7a94e17ba65f39b26b54753-d3cb080fc442fea1a97a29e7d4f1ccf4-sd.m3u8'],
  ['1:40', 'https://v-mps.crazymaplestudios.com/vod-112094/20a14852cb8071f18626e7e7c7690102/4db0a3bc9d474fef84ba944afd780fbd-ecee15547e2224bb15a30d5eb100db95-sd.m3u8'],
  ['1:14', 'https://v-mps.crazymaplestudios.com/vod-112094/60cc4652cb8071f19da7e6e7d77b0102/b84f80d3b4fd4a1fbc7878c79029d2e9-5e7f675a7a4602ba7ede7ca5ab6eb2f6-sd.m3u8'],
  ['2:53', 'https://v-mps.crazymaplestudios.com/vod-112094/e00d6757cb8071f18626e7e7c7690102/832876f2cc3445b19ebda76240ce509b-d0f49778745d9d88d37ae4b8a04ea66a-sd.m3u8'],
  ['1:12', 'https://v-mps.crazymaplestudios.com/vod-112094/70304c4ccb8071f19baff7e7c57a0102/4d61a46e74d843bda6be9728523f6447-9f650c72ed2a4fde8aa0e4930c5e1273-sd.m3u8'],
  ['1:10', 'https://v-mps.crazymaplestudios.com/vod-112094/e0f8734bcb8071f18600f6f6d65a0102/f1a61d014b224558a29e6751ff6a9f17-ef86423dfd00cbb5346dc7d271e41eac-sd.m3u8'],
  ['1:02', 'https://v-mps.crazymaplestudios.com/vod-112094/80811b53cb8071f19da7e6e7d77b0102/0e5e9242a88a4f9c8de533ddd8331947-34d71dbfa186180a54d4bce7b11a72bf-sd.m3u8'],
  ['1:03', 'https://v-mps.crazymaplestudios.com/vod-112094/601e0a4ccb8071f18dbde6f6c55a0102/73bcac469cb54195aeae57a444b887ae-54c7ec49098ef23b6f5ff4ce3f9d7d09-sd.m3u8'],
  ['0:45', 'https://v-mps.crazymaplestudios.com/vod-112094/602b9a45cb8071f18555e6f6c55b0102/af8fd022b4f345489214404b677b0025-3d48ce42e45d55534f5ca02ad2f48d67-sd.m3u8'],
  ['0:50', 'https://v-mps.crazymaplestudios.com/vod-112094/a0615d52cb8071f1a13de6e7c64b0102/8dd2422833ae46559faa3cb4d9fe55a5-05ac3100a3f6ca1eb989f78c23ba8ac2-sd.m3u8'],
]);

function overrides() {
  try {
    const parsed = JSON.parse(String(process.env.EXTRA_TRIPLETS_FINAL_REGRET_PLAYLISTS_JSON || '[]'));
    return Array.isArray(parsed) ? parsed.map(value => String(value || '').trim()) : [];
  } catch {
    return [];
  }
}

export function tripletsFinalRegret() {
  const custom = overrides();
  const series = Object.freeze({
    id: 'o-arrependimento-final-dos-trigemeos',
    name: 'O Arrependimento Final dos Trigêmeos',
    categoryId: 'reelshort',
    imageUrl: COVER_URL,
    synopsis: SYNOPSIS,
    year: 2026,
    status: 'Concluída',
    format: 'Animação',
    originalLanguage: 'Inglês',
    audioLanguages: ['pt-BR'],
    defaultAudioLanguage: 'pt-BR',
    dubbed: true,
    totalEpisodes: STREAMS.length,
  });
  const episodes = Object.freeze(STREAMS.map(([duration, defaultUrl], index) => Object.freeze({
    id: `${series.id}-episode-${String(index + 1).padStart(2, '0')}`,
    name: `Episódio ${index + 1}`,
    number: index + 1,
    season: '1',
    seriesId: series.id,
    extension: 'm3u8',
    duration,
    audioLanguages: ['pt-BR'],
    defaultAudioLanguage: 'pt-BR',
    playlistUrl: custom[index] || defaultUrl,
  })));
  return Object.freeze({ series, episodes });
}

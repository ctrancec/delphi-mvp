/**
 * The source registry — the heart of Delphi World.
 *
 * This is a clean-room build. World Monitor is AGPL-3.0-only, so copying or
 * deriving from its source would force this whole hosted app under AGPL. What
 * is used here is the same *public inputs* — RSS endpoints and official
 * embeddable streams — which are facts and addresses, not protected
 * expression. No part of their implementation was read.
 *
 * The priority is deliberately different from an English-language feed reader:
 * worldwide outlet coverage, translated to English, with accuracy established
 * by corroboration rather than asserted.
 *
 * **State-affiliated outlets are included on purpose.** TASS and Anadolu are
 * signal about what a state is saying, which is worth knowing precisely
 * because it is not neutral. `lean: 'state'` travels with every item they
 * produce, so nothing is ever presented as neutral when it is not, and the
 * corroboration score treats agreement *across* state and independent outlets
 * as the strong signal rather than volume from either.
 */

export interface SeedSource {
    name: string;
    /** ISO 3166-1 alpha-2. */
    country: string;
    /** ISO 639-1. */
    language: string;
    category: 'wire' | 'national' | 'financial' | 'regional' | 'broadcast';
    lean: 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'state';
    /** 1 is most reliable. Drives corroboration weight, not visibility. */
    reliabilityTier: 1 | 2 | 3;
    rssUrl: string;
    siteUrl: string;
}

export const SEED_SOURCES: SeedSource[] = [
    // Reuters, AP, EFE, Xinhua, TRT and the Kyiv Independent were in an earlier
    // draft and are gone: their published endpoints 404, or refuse every
    // client. A registry of plausible URLs that return nothing is worse than a
    // smaller one that works, because the corroboration score would quietly be
    // computed over a narrower world than it claims.
    //
    // Of what remains, 17 were verified to fetch and parse; about a dozen
    // answer a browser but refuse this client at the connection layer. Those
    // are kept enabled rather than pruned, because that refusal is partly a
    // matter of egress IP reputation and may not hold from the deployment's
    // address. Health is tracked per source and surfaced in the UI, so the
    // page states which ones are actually contributing rather than implying
    // that all of them are.

    // --- Wires. A wire carrying a story is the strongest single corroboration signal.
    { name: 'AFP via France 24', country: 'FR', language: 'en', category: 'wire', lean: 'center', reliabilityTier: 1, rssUrl: 'https://www.france24.com/en/rss', siteUrl: 'https://www.france24.com' },
    { name: 'Anadolu Agency', country: 'TR', language: 'en', category: 'wire', lean: 'state', reliabilityTier: 3, rssUrl: 'https://www.aa.com.tr/en/rss/default?cat=live', siteUrl: 'https://www.aa.com.tr' },
    { name: 'TASS', country: 'RU', language: 'en', category: 'wire', lean: 'state', reliabilityTier: 3, rssUrl: 'https://tass.com/rss/v2.xml', siteUrl: 'https://tass.com' },

    // --- Broadcast, spread across regions rather than defaulting to Anglophone.
    { name: 'BBC World', country: 'GB', language: 'en', category: 'broadcast', lean: 'center', reliabilityTier: 1, rssUrl: 'https://feeds.bbci.co.uk/news/world/rss.xml', siteUrl: 'https://www.bbc.com/news' },
    { name: 'Al Jazeera English', country: 'QA', language: 'en', category: 'broadcast', lean: 'center-left', reliabilityTier: 2, rssUrl: 'https://www.aljazeera.com/xml/rss/all.xml', siteUrl: 'https://www.aljazeera.com' },
    { name: 'Al Jazeera Arabic', country: 'QA', language: 'ar', category: 'broadcast', lean: 'center-left', reliabilityTier: 2, rssUrl: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9', siteUrl: 'https://www.aljazeera.net' },
    { name: 'Deutsche Welle', country: 'DE', language: 'en', category: 'broadcast', lean: 'center', reliabilityTier: 1, rssUrl: 'https://rss.dw.com/rdf/rss-en-world', siteUrl: 'https://www.dw.com' },
    { name: 'NHK', country: 'JP', language: 'ja', category: 'broadcast', lean: 'center', reliabilityTier: 1, rssUrl: 'https://www3.nhk.or.jp/rss/news/cat6.xml', siteUrl: 'https://www3.nhk.or.jp' },
    { name: 'CNA', country: 'SG', language: 'en', category: 'broadcast', lean: 'center', reliabilityTier: 2, rssUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', siteUrl: 'https://www.channelnewsasia.com' },
    { name: 'France 24', country: 'FR', language: 'fr', category: 'broadcast', lean: 'center', reliabilityTier: 2, rssUrl: 'https://www.france24.com/fr/rss', siteUrl: 'https://www.france24.com/fr' },
    { name: 'ABC News Australia', country: 'AU', language: 'en', category: 'broadcast', lean: 'center', reliabilityTier: 1, rssUrl: 'https://www.abc.net.au/news/feed/2942460/rss.xml', siteUrl: 'https://www.abc.net.au/news' },

    // --- National press, several in their own languages. These are the reason
    //     the translation pass exists at all.
    { name: 'The Guardian World', country: 'GB', language: 'en', category: 'national', lean: 'center-left', reliabilityTier: 1, rssUrl: 'https://www.theguardian.com/world/rss', siteUrl: 'https://www.theguardian.com' },
    { name: 'Le Monde', country: 'FR', language: 'fr', category: 'national', lean: 'center-left', reliabilityTier: 1, rssUrl: 'https://www.lemonde.fr/international/rss_full.xml', siteUrl: 'https://www.lemonde.fr' },
    { name: 'El País', country: 'ES', language: 'es', category: 'national', lean: 'center-left', reliabilityTier: 1, rssUrl: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada', siteUrl: 'https://elpais.com' },
    { name: 'Der Spiegel', country: 'DE', language: 'de', category: 'national', lean: 'center-left', reliabilityTier: 1, rssUrl: 'https://www.spiegel.de/international/index.rss', siteUrl: 'https://www.spiegel.de/international' },
    { name: 'Folha de S.Paulo', country: 'BR', language: 'pt', category: 'national', lean: 'center', reliabilityTier: 2, rssUrl: 'https://feeds.folha.uol.com.br/mundo/rss091.xml', siteUrl: 'https://www.folha.uol.com.br' },
    { name: 'The Hindu', country: 'IN', language: 'en', category: 'national', lean: 'center-left', reliabilityTier: 1, rssUrl: 'https://www.thehindu.com/news/international/feeder/default.rss', siteUrl: 'https://www.thehindu.com' },
    { name: 'The Times of India', country: 'IN', language: 'en', category: 'national', lean: 'center-right', reliabilityTier: 2, rssUrl: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', siteUrl: 'https://timesofindia.indiatimes.com' },
    { name: 'South China Morning Post', country: 'HK', language: 'en', category: 'national', lean: 'center', reliabilityTier: 2, rssUrl: 'https://www.scmp.com/rss/91/feed', siteUrl: 'https://www.scmp.com' },
    { name: 'The Jerusalem Post', country: 'IL', language: 'en', category: 'national', lean: 'center-right', reliabilityTier: 2, rssUrl: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', siteUrl: 'https://www.jpost.com' },
    { name: 'The Korea Herald', country: 'KR', language: 'en', category: 'national', lean: 'center', reliabilityTier: 2, rssUrl: 'https://www.koreaherald.com/rss/020000000000.xml', siteUrl: 'https://www.koreaherald.com' },
    { name: 'The Moscow Times', country: 'RU', language: 'en', category: 'national', lean: 'center', reliabilityTier: 2, rssUrl: 'https://www.themoscowtimes.com/rss/news', siteUrl: 'https://www.themoscowtimes.com' },
    { name: 'Nikkei Asia', country: 'JP', language: 'en', category: 'national', lean: 'center', reliabilityTier: 1, rssUrl: 'https://asia.nikkei.com/rss/feed/nar', siteUrl: 'https://asia.nikkei.com' },

    // --- Financial. These also feed the Stock Market Research department.
    { name: 'Wall Street Journal World', country: 'US', language: 'en', category: 'financial', lean: 'center-right', reliabilityTier: 1, rssUrl: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', siteUrl: 'https://www.wsj.com' },
    { name: 'Financial Times', country: 'GB', language: 'en', category: 'financial', lean: 'center', reliabilityTier: 1, rssUrl: 'https://www.ft.com/rss/home/international', siteUrl: 'https://www.ft.com' },
    { name: 'CNBC World', country: 'US', language: 'en', category: 'financial', lean: 'center', reliabilityTier: 2, rssUrl: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', siteUrl: 'https://www.cnbc.com' },
    { name: 'MarketWatch', country: 'US', language: 'en', category: 'financial', lean: 'center', reliabilityTier: 2, rssUrl: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', siteUrl: 'https://www.marketwatch.com' },
    { name: 'Economic Times Markets', country: 'IN', language: 'en', category: 'financial', lean: 'center', reliabilityTier: 2, rssUrl: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', siteUrl: 'https://economictimes.indiatimes.com' },
    { name: 'Handelsblatt', country: 'DE', language: 'de', category: 'financial', lean: 'center-right', reliabilityTier: 2, rssUrl: 'https://www.handelsblatt.com/contentexport/feed/schlagzeilen', siteUrl: 'https://www.handelsblatt.com' },
];

/**
 * How Delphi identifies itself when fetching a feed. Honestly.
 *
 * A browser user-agent string was tried and abandoned. Roughly a third of
 * these outlets sit behind CDN bot protection that refuses this client with a
 * 403 — and claiming to be Chrome did not change that, because the refusal is
 * made below the header layer, on the shape of the connection itself. The
 * same URLs answer `curl` and a real browser and refuse Node either way.
 *
 * So the disguise bought nothing, and going further — matching a browser's TLS
 * and HTTP/2 fingerprint — would be defeating bot protection rather than
 * identifying as a feed reader. Delphi says what it is instead, and a source
 * that refuses it is recorded as a blind spot rather than worked around.
 *
 * Politeness is in the mechanics: one scheduled pass, bounded concurrency, and
 * a source marked unhealthy rather than retried in a loop.
 */
export const FEED_USER_AGENT = 'Delphi/1.0 (+https://delphi-mvp.vercel.app; feed reader)';

export interface SeedStream {
    label: string;
    provider: 'youtube';
    /** YouTube video id of the outlet's own 24/7 stream. */
    externalId: string;
    category: 'news' | 'financial' | 'regional';
    language: string;
    sortOrder: number;
}

/**
 * Official, publicly embeddable 24/7 streams, played through YouTube's own
 * IFrame player.
 *
 * Scope boundary, and it is a hard one: nothing is scraped, re-streamed, or
 * lifted past a paywall or a geo-restriction. That is both legally exposed and
 * operationally fragile. If an outlet does not publish an embeddable stream, it
 * does not appear here.
 *
 * Stream ids do rotate when an outlet restarts a broadcast; a tile that fails
 * to load is a dead id, not a broken player.
 */
export const SEED_STREAMS: SeedStream[] = [
    { label: 'Al Jazeera English', provider: 'youtube', externalId: 'gCNeDWCI0vo', category: 'news', language: 'en', sortOrder: 10 },
    { label: 'DW News', provider: 'youtube', externalId: 'pqabxBKzZ6M', category: 'news', language: 'en', sortOrder: 20 },
    { label: 'France 24 English', provider: 'youtube', externalId: 'Ap-UM1O9RBU', category: 'news', language: 'en', sortOrder: 30 },
    { label: 'Sky News', provider: 'youtube', externalId: 'YDvsBbKfLPA', category: 'news', language: 'en', sortOrder: 40 },
    { label: 'ABC News Live', provider: 'youtube', externalId: 'w_Ma8oQLmSM', category: 'news', language: 'en', sortOrder: 50 },
    { label: 'NBC News Now', provider: 'youtube', externalId: 'Jd8eaHnsUx8', category: 'news', language: 'en', sortOrder: 60 },
    { label: 'CNA', provider: 'youtube', externalId: 'XWq5kBlakcQ', category: 'regional', language: 'en', sortOrder: 70 },
    { label: 'TRT World', provider: 'youtube', externalId: '_ovRq6oqRwM', category: 'regional', language: 'en', sortOrder: 80 },
];

/** Rough region for a country code, for grouping the feed without a geo library. */
export function regionOf(country: string): string {
    const map: Record<string, string> = {
        US: 'Americas', BR: 'Americas', CA: 'Americas', MX: 'Americas',
        GB: 'Europe', FR: 'Europe', DE: 'Europe', ES: 'Europe', RU: 'Europe', UA: 'Europe',
        CN: 'Asia', JP: 'Asia', IN: 'Asia', SG: 'Asia', HK: 'Asia', KR: 'Asia',
        QA: 'Middle East', IL: 'Middle East', TR: 'Middle East',
        AU: 'Oceania', NZ: 'Oceania',
    };
    return map[country] ?? 'Other';
}

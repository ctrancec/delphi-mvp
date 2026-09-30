/**
 * Prove the free stock screens say only what the data supports.
 *
 * Every failure worth fearing here is quiet — a screen that runs, ranks, and
 * reads well while being wrong:
 *
 *  - Air Canada's numbers taken from a different company that happens to trade
 *    as AC in New York;
 *  - capital spending added to cash flow instead of subtracted, because one
 *    filer reports it as a negative;
 *  - a yield computed from yen of cash flow over dollars of market value;
 *  - a stock list the search engine never actually read, passed on as a source;
 *  - a company that cannot service its debt ranked as value;
 *  - a screen that hides it is not a full-market scan.
 *
 * None of those throws. So each is asserted, against a small SEC and Finnhub
 * built from the response shapes captured while this was designed. No network.
 */

import {
    derive,
    describeFiling,
    financialKind,
    filingUrl,
    fromCompanyFacts,
    fundamentalsFor,
    qualityLeaders,
    recentFilings,
    setSecClock,
    type Fundamentals,
} from '../src/lib/channels/sec';
import {
    checkFinnhubHealth,
    cleanKey,
    keyShapeProblem,
    MAX_TICKERS_PER_CALL,
    resolveListing,
    snapshots,
    tsxBase,
    setFinnhubClock,
} from '../src/lib/channels/finnhub';
import { fcfYieldOf, normalizeTsxSymbol, screenMomentum, screenValue, tally, vetLists } from '../src/lib/channels/screens';
import { toolsForChannels } from '../src/lib/channels/registry';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(58)}${note ? D + note + RS : ''}`);
};
const near = (a: number | undefined, b: number, eps = 1e-6) => a !== undefined && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// ---------------------------------------------------------------------------
// A clock that never really sleeps
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-09-27T12:00:00Z');
let t = NOW;
let slept = 0;
const clock = { now: () => t, sleep: async (ms: number) => { slept++; t += ms; } };
const reset = () => {
    t = NOW;
    slept = 0;
    setSecClock(clock);
    setFinnhubClock(clock);
    process.env.SEC_CONTACT = 'test@example.com';
    process.env.FINNHUB_API_KEY = 'test-key';
};

// ---------------------------------------------------------------------------
// A small SEC and Finnhub
// ---------------------------------------------------------------------------

const CIK = {
    AAPL: 320193, CNI: 16868, TM: 1094517, BB: 1070235, BUYB: 555555, TINY: 666666,
    NOK: 924613, HMC: 715153, PROD: 777777, GAP: 777778, TTM: 777779, OLD: 888888, GONE: 999999, BANK: 444444, PAYS: 333333,
};

const TICKERS: Record<string, { cik_str: number; ticker: string; title: string }> = {
    '0': { cik_str: CIK.AAPL, ticker: 'AAPL', title: 'Apple Inc.' },
    '1': { cik_str: CIK.CNI, ticker: 'CNI', title: 'CANADIAN NATIONAL RAILWAY CO' },
    '2': { cik_str: CIK.TM, ticker: 'TM', title: 'TOYOTA MOTOR CORP/' },
    // Deliberately not BlackBerry: the mapping check must catch it.
    '3': { cik_str: CIK.BB, ticker: 'BB', title: 'BLUE BIRD CORP' },
    '4': { cik_str: CIK.BUYB, ticker: 'BUYB', title: 'Buyback Heavy Inc.' },
    '5': { cik_str: CIK.TINY, ticker: 'TINY', title: 'Tiny Co' },
    '6': { cik_str: CIK.NOK, ticker: 'NOK', title: 'Nokia Corp' },
    '7': { cik_str: CIK.HMC, ticker: 'HMC', title: 'HONDA MOTOR CO LTD' },
    '8': { cik_str: CIK.PROD, ticker: 'PROD', title: 'Productive Assets Co' },
    '9': { cik_str: CIK.GAP, ticker: 'GAP1', title: 'Gap In The Frames Inc.' },
    '10': { cik_str: CIK.OLD, ticker: 'OLD', title: 'Stopped Filing Corp' },
    '11': { cik_str: CIK.GONE, ticker: 'GONE', title: 'Gone Quiet Corp' },
    '12': { cik_str: CIK.TTM, ticker: 'TTMX', title: 'Trailing Twelve Inc.' },
    '13': { cik_str: CIK.BANK, ticker: 'BANK', title: 'Big Deposit Bank Corp' },
    '14': { cik_str: CIK.PAYS, ticker: 'PAYS', title: 'Pays Money Transfer plc' },
};

type Row = [cik: number, val: number, end: string, accn: string];
const FRAMES: Record<string, Record<string, Row[]>> = {
    NetCashProvidedByUsedInOperatingActivities: {
        CY2025: [[CIK.AAPL, 118e9, '2025-09-27', 'A-25'], [CIK.CNI, 5.1e9, '2025-12-31', 'C-25'], [CIK.BUYB, 9e9, '2025-12-31', 'B-25'], [CIK.TINY, 50e6, '2025-12-31', 'T-25'], [CIK.PROD, 150e6, '2025-12-31', 'P-25'], [CIK.GAP, 60e6, '2025-12-31', 'G-25'], [CIK.BANK, 20e9, '2025-12-31', 'K-25'], [CIK.PAYS, 7.5e9, '2025-12-31', 'W-25']],
        // A large company whose last filing covered the year to mid-2024.
        CY2024: [[CIK.AAPL, 110e9, '2024-09-28', 'A-24'], [CIK.CNI, 5.0e9, '2024-12-31', 'C-24'], [CIK.BUYB, 8.5e9, '2024-12-31', 'B-24'], [CIK.GONE, 3e9, '2024-06-30', 'X-24']],
    },
    PaymentsToAcquirePropertyPlantAndEquipment: {
        CY2025: [[CIK.AAPL, 12e9, '2025-09-27', 'A-25'], [CIK.CNI, 3.4e9, '2025-12-31', 'C-25'], [CIK.BUYB, 1e9, '2025-12-31', 'B-25'], [CIK.TINY, 5e6, '2025-12-31', 'T-25'], [CIK.BANK, 1e9, '2025-12-31', 'K-25'], [CIK.PAYS, 0.02e9, '2025-12-31', 'W-25']],
        // PROD's capex under this concept stops a year before its cash flow.
        CY2024: [[CIK.PROD, 30e6, '2024-12-31', 'P-24'], [CIK.GONE, 0.5e9, '2024-06-30', 'X-24']],
    },
    // How Nvidia, Amazon, Ford and PepsiCo file their capital spending.
    PaymentsToAcquireProductiveAssets: {
        CY2025: [[CIK.PROD, 40e6, '2025-12-31', 'P-25']],
    },
    NetIncomeLoss: {
        CY2025: [[CIK.AAPL, 100e9, '2025-09-27', 'A-25'], [CIK.CNI, 3.5e9, '2025-12-31', 'C-25'], [CIK.BUYB, 7e9, '2025-12-31', 'B-25'], [CIK.TINY, 10e6, '2025-12-31', 'T-25'], [CIK.PROD, 60e6, '2025-12-31', 'P-25'], [CIK.GAP, 20e6, '2025-12-31', 'G-25'], [CIK.BANK, 8e9, '2025-12-31', 'K-25'], [CIK.PAYS, 0.5e9, '2025-12-31', 'W-25']],
        CY2024: [[CIK.AAPL, 94e9, '2024-09-28', 'A-24'], [CIK.CNI, 3.4e9, '2024-12-31', 'C-24'], [CIK.BUYB, 6.5e9, '2024-12-31', 'B-24'], [CIK.GONE, 2e9, '2024-06-30', 'X-24']],
    },
    // CN Rail reports revenue under one concept, Apple under another.
    Revenues: {
        CY2025: [[CIK.CNI, 12.4e9, '2025-12-31', 'C-25'], [CIK.BUYB, 25e9, '2025-12-31', 'B-25'], [CIK.TINY, 200e6, '2025-12-31', 'T-25'], [CIK.PROD, 400e6, '2025-12-31', 'P-25'], [CIK.GAP, 300e6, '2025-12-31', 'G-25'], [CIK.BANK, 30e9, '2025-12-31', 'K-25'], [CIK.PAYS, 2e9, '2025-12-31', 'W-25']],
        CY2024: [[CIK.CNI, 12.0e9, '2024-12-31', 'C-24'], [CIK.BUYB, 24e9, '2024-12-31', 'B-24'], [CIK.PROD, 350e6, '2024-12-31', 'P-24'], [CIK.GAP, 250e6, '2024-12-31', 'G-24'], [CIK.GONE, 20e9, '2024-06-30', 'X-24'], [CIK.BANK, 28e9, '2024-12-31', 'K-24'], [CIK.PAYS, 1.7e9, '2024-12-31', 'W-24']],
        CY2026Q2: [[CIK.CNI, 3.2e9, '2026-06-30', 'C-26q2'], [CIK.GAP, 90e6, '2026-06-30', 'G-26q2']],
        CY2025Q2: [[CIK.CNI, 3.1e9, '2025-06-30', 'C-25q2'], [CIK.GAP, 70e6, '2025-06-30', 'G-25q2']],
        CY2026Q1: [[CIK.CNI, 3.0e9, '2026-03-31', 'C-26q1'], [CIK.GAP, 80e6, '2026-03-31', 'G-26q1']],
        CY2025Q1: [[CIK.CNI, 2.9e9, '2025-03-31', 'C-25q1'], [CIK.GAP, 70e6, '2025-03-31', 'G-25q1']],
    },
    RevenueFromContractWithCustomerExcludingAssessedTax: {
        CY2025: [[CIK.AAPL, 400e9, '2025-09-27', 'A-25']],
        CY2024: [[CIK.AAPL, 390e9, '2024-09-28', 'A-24']],
        CY2026Q2: [[CIK.AAPL, 95e9, '2026-06-27', 'A-26q3']],
        CY2025Q2: [[CIK.AAPL, 85e9, '2025-06-28', 'A-25q3']],
        CY2026Q1: [[CIK.AAPL, 110e9, '2026-03-28', 'A-26q2']],
        CY2025Q1: [[CIK.AAPL, 105e9, '2025-03-29', 'A-25q2']],
    },
    LongTermDebtNoncurrent: { CY2026Q2I: [[CIK.CNI, 18e9, '2026-06-30', 'C-26q2']] },
    LongTermDebtCurrent: { CY2026Q2I: [[CIK.CNI, 1.1e9, '2026-06-30', 'C-26q2']] },
    LongTermDebt: { CY2026Q2I: [[CIK.AAPL, 95e9, '2026-06-27', 'A-26q3'], [CIK.BUYB, 30e9, '2026-06-30', 'B-26q2']] },
    CashAndCashEquivalentsAtCarryingValue: {
        CY2026Q2I: [[CIK.AAPL, 30e9, '2026-06-27', 'A-26q3'], [CIK.CNI, 0.4e9, '2026-06-30', 'C-26q2'], [CIK.BUYB, 5e9, '2026-06-30', 'B-26q2']],
    },
    // Buybacks can push equity negative at a perfectly healthy company.
    StockholdersEquity: {
        CY2026Q2I: [[CIK.AAPL, 60e9, '2026-06-27', 'A-26q3'], [CIK.CNI, 20e9, '2026-06-30', 'C-26q2'], [CIK.BUYB, -4e9, '2026-06-30', 'B-26q2']],
    },
};

/** Forty sound, unremarkable companies, for the caps. */
const SYNTH = Array.from({ length: 40 }, (_, i) => ({ cik: 900001 + i, ticker: `Q${i + 1}` }));
function addSynthetic() {
    SYNTH.forEach((s, i) => {
        TICKERS[`s${i}`] = { cik_str: s.cik, ticker: s.ticker, title: `Synthetic ${s.ticker} Inc.` };
        FRAMES.NetCashProvidedByUsedInOperatingActivities.CY2025.push([s.cik, 1e9 + i * 1e7, '2025-12-31', `S-${i}`]);
        FRAMES.PaymentsToAcquirePropertyPlantAndEquipment.CY2025.push([s.cik, 1e8, '2025-12-31', `S-${i}`]);
        FRAMES.NetIncomeLoss.CY2025.push([s.cik, 5e8, '2025-12-31', `S-${i}`]);
        FRAMES.Revenues.CY2025.push([s.cik, 5e9, '2025-12-31', `S-${i}`]);
        FRAMES.Revenues.CY2024.push([s.cik, 4.8e9, '2024-12-31', `S-${i - 1}`]);
    });
}

const TM_FACTS = {
    facts: {
        'ifrs-full': {
            Revenue: {
                units: {
                    JPY: [
                        { start: '2024-04-01', end: '2025-03-31', val: 48e12, accn: 'T-25', fp: 'FY', form: '20-F' },
                        { start: '2023-04-01', end: '2024-03-31', val: 45e12, accn: 'T-24', fp: 'FY', form: '20-F' },
                        // A quarter, which must not be mistaken for a year.
                        { start: '2025-01-01', end: '2025-03-31', val: 12e12, accn: 'T-25q' },
                    ],
                },
            },
            ProfitLossAttributableToOwnersOfParent: {
                units: {
                    JPY: [
                        { start: '2024-04-01', end: '2025-03-31', val: 4.8e12, accn: 'T-25' },
                        { start: '2023-04-01', end: '2024-03-31', val: 4.9e12, accn: 'T-24' },
                    ],
                },
            },
            CashFlowsFromUsedInOperatingActivities: {
                units: { JPY: [{ start: '2024-04-01', end: '2025-03-31', val: 3.6e12, accn: 'T-25' }] },
            },
            PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities: {
                units: { JPY: [{ start: '2024-04-01', end: '2025-03-31', val: 2.0e12, accn: 'T-25' }] },
            },
        },
    },
};

/** Seen live: Nokia's old revenue concept stops in 2017; the one it files now runs to date. */
const NOK_FACTS = {
    facts: {
        'ifrs-full': {
            Revenue: {
                units: {
                    EUR: [
                        { start: '2016-01-01', end: '2016-12-31', val: 23.6e9, accn: 'N-16' },
                        { start: '2017-01-01', end: '2017-12-31', val: 23.1e9, accn: 'N-17' },
                    ],
                },
            },
            RevenueFromContractsWithCustomers: {
                units: {
                    EUR: [
                        { start: '2024-01-01', end: '2024-12-31', val: 19.2e9, accn: 'N-24' },
                        { start: '2025-01-01', end: '2025-12-31', val: 19.9e9, accn: 'N-25' },
                    ],
                },
            },
            ProfitLossAttributableToOwnersOfParent: {
                units: { EUR: [{ start: '2025-01-01', end: '2025-12-31', val: 1.3e9, accn: 'N-25' }] },
            },
            CashFlowsFromUsedInOperatingActivities: {
                units: { EUR: [{ start: '2025-01-01', end: '2025-12-31', val: 2.4e9, accn: 'N-25' }] },
            },
            PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets: {
                units: { EUR: [{ start: '2025-01-01', end: '2025-12-31', val: 0.6e9, accn: 'N-25' }] },
            },
            Borrowings: { units: { EUR: [{ end: '2025-12-31', val: 3.4e9, accn: 'N-25' }] } },
            LongtermBorrowings: { units: { EUR: [{ end: '2025-12-31', val: 2.3e9, accn: 'N-25' }] } },
            CashAndCashEquivalents: { units: { EUR: [{ end: '2025-12-31', val: 6.0e9, accn: 'N-25' }] } },
        },
    },
};

/** Seen live: Honda filed under US GAAP until 2014, and under IFRS since. */
const HMC_FACTS = {
    facts: {
        'us-gaap': {
            Revenues: {
                units: {
                    JPY: [
                        { start: '2012-04-01', end: '2013-03-31', val: 9.9e12, accn: 'H-13' },
                        { start: '2013-04-01', end: '2014-03-31', val: 11.8e12, accn: 'H-14' },
                    ],
                },
            },
            NetCashProvidedByUsedInOperatingActivities: {
                units: { JPY: [{ start: '2013-04-01', end: '2014-03-31', val: 1.0e12, accn: 'H-14' }] },
            },
            // The only debt figure on file is the 2014 one.
            LongTermDebt: { units: { JPY: [{ end: '2014-03-31', val: 3.0e12, accn: 'H-14' }] } },
        },
        'ifrs-full': {
            Revenue: {
                units: {
                    JPY: [
                        { start: '2023-04-01', end: '2024-03-31', val: 20.4e12, accn: 'H-24' },
                        { start: '2024-04-01', end: '2025-03-31', val: 21.7e12, accn: 'H-25' },
                    ],
                },
            },
            CashFlowsFromUsedInOperatingActivities: {
                units: { JPY: [{ start: '2024-04-01', end: '2025-03-31', val: 2.0e12, accn: 'H-25' }] },
            },
            // Capex for the year before only.
            PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities: {
                units: { JPY: [{ start: '2023-04-01', end: '2024-03-31', val: 0.6e12, accn: 'H-24' }] },
            },
        },
    },
};

/** A filer whose capex the frames lack; its own fact set has it, and its debt split in two. */
const GAP_FACTS = {
    facts: {
        'us-gaap': {
            Revenues: { units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 300e6, accn: 'G-25' }] } },
            NetCashProvidedByUsedInOperatingActivities: {
                units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 60e6, accn: 'G-25' }] },
            },
            PaymentsToAcquirePropertyPlantAndEquipment: {
                units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 20e6, accn: 'G-25' }] },
            },
            // A total it stopped reporting in 2019, and the two halves it reports now.
            LongTermDebt: { units: { USD: [{ end: '2019-12-31', val: 500e6, accn: 'G-19' }] } },
            LongTermDebtNoncurrent: { units: { USD: [{ end: '2026-06-30', val: 100e6, accn: 'G-26q2' }] } },
            LongTermDebtCurrent: { units: { USD: [{ end: '2026-06-30', val: 10e6, accn: 'G-26q2' }] } },
        },
    },
};

/**
 * Seen live at Amazon: each quarterly report also gives cash flow for the
 * twelve months to that quarter, so the newest free cash flow runs past the
 * newest annual revenue. And no debt figure at all, as at Ford and PepsiCo.
 */
const TTM_FACTS = {
    facts: {
        'us-gaap': {
            Revenues: { units: { USD: [{ start: '2025-01-01', end: '2025-12-31', val: 700e9, accn: 'X-25' }] } },
            NetCashProvidedByUsedInOperatingActivities: {
                units: {
                    USD: [
                        { start: '2025-01-01', end: '2025-12-31', val: 130e9, accn: 'X-25' },
                        { start: '2025-07-01', end: '2026-06-30', val: 140e9, accn: 'X-26q2' },
                    ],
                },
            },
            PaymentsToAcquireProductiveAssets: {
                units: {
                    USD: [
                        { start: '2025-01-01', end: '2025-12-31', val: 120e9, accn: 'X-25' },
                        { start: '2025-07-01', end: '2026-06-30', val: 150e9, accn: 'X-26q2' },
                    ],
                },
            },
        },
    },
};

/** A company that stopped filing years ago. */
const OLD_FACTS = {
    facts: {
        'us-gaap': {
            Revenues: {
                units: {
                    USD: [
                        { start: '2018-01-01', end: '2018-12-31', val: 900e6, accn: 'O-18' },
                        { start: '2019-01-01', end: '2019-12-31', val: 950e6, accn: 'O-19' },
                    ],
                },
            },
            NetCashProvidedByUsedInOperatingActivities: {
                units: { USD: [{ start: '2019-01-01', end: '2019-12-31', val: 120e6, accn: 'O-19' }] },
            },
        },
    },
};

const FACTS: Record<number, object> = {
    [CIK.TM]: TM_FACTS,
    [CIK.NOK]: NOK_FACTS,
    [CIK.HMC]: HMC_FACTS,
    [CIK.GAP]: GAP_FACTS,
    [CIK.TTM]: TTM_FACTS,
    [CIK.OLD]: OLD_FACTS,
};

const CNI_SUBMISSIONS = {
    sic: '4011',
    sicDescription: 'Railroads, Line-Haul Operating',
    filings: {
        recent: {
            accessionNumber: ['0000016868-26-000031', '0000016868-26-000029', '0000016868-26-000010'],
            filingDate: ['2026-09-20', '2026-09-02', '2026-07-25'],
            form: ['8-K', '6-K', '10-Q'],
            primaryDocument: ['cni-8k.htm', 'cni-6k.htm', 'cni-10q.htm'],
            items: ['2.02,9.01', '', ''],
        },
    },
};

const quote = (c: number, dp: number) => ({ c, d: 0, dp, h: c, l: c, o: c, pc: c, t: Math.floor(Date.parse('2026-09-25T20:00:00Z') / 1000) });
const FH: Record<string, { quote: object; metric: Record<string, number | string> }> = {
    AAPL: {
        quote: quote(224.58, 0.5),
        metric: {
            '52WeekHigh': 260, '52WeekLow': 212, '52WeekLowDate': '2026-04-08', '52WeekHighDate': '2025-12-26',
            '5DayPriceReturnDaily': 1.1, '13WeekPriceReturnDaily': 12, '26WeekPriceReturnDaily': 20, '52WeekPriceReturnDaily': 5,
            '10DayAverageTradingVolume': 60, '3MonthAverageTradingVolume': 50, peTTM: 30.1, marketCapitalization: 3_400_000,
            pfcfShareTTM: 32, 'priceRelativeToS&P5004Week': 2, 'priceRelativeToS&P50013Week': 4, 'priceRelativeToS&P50026Week': 6,
        },
    },
    CNI: {
        quote: quote(120.93, 0.81),
        metric: {
            '52WeekHigh': 131.55, '52WeekLow': 116.1, '5DayPriceReturnDaily': 1.2, '13WeekPriceReturnDaily': -3,
            '26WeekPriceReturnDaily': -5.1, '52WeekPriceReturnDaily': 8, '10DayAverageTradingVolume': 1.1,
            '3MonthAverageTradingVolume': 0.8, peTTM: 18.2, marketCapitalization: 73_053.8,
        },
    },
    BUYB: {
        quote: quote(50, 0.2),
        metric: { '52WeekHigh': 55, '52WeekLow': 30, '13WeekPriceReturnDaily': 5, '26WeekPriceReturnDaily': 9, marketCapitalization: 60_000 },
    },
    // Up 75% in six months, a few percent off its high.
    HOT: {
        quote: quote(98, 1.5),
        metric: { '52WeekHigh': 100, '52WeekLow': 40, '13WeekPriceReturnDaily': 40, '26WeekPriceReturnDaily': 75, '10DayAverageTradingVolume': 9, '3MonthAverageTradingVolume': 6 },
    },
};

const requests: { url: URL; ua: string; at: number }[] = [];
/** Companies whose fact set SEC fails to serve. */
const FAILING = new Set<number>();
/** Companies whose submissions record — and so industry — SEC fails to serve. */
const FAILING_SUBMISSIONS = new Set<number>();

const SUBMISSIONS: Record<number, object> = {
    [CIK.CNI]: CNI_SUBMISSIONS,
    [CIK.AAPL]: { sic: '3571', sicDescription: 'Electronic Computers' },
    [CIK.BANK]: { sic: '6021', sicDescription: 'National Commercial Banks' },
    // Seen live at Wise: a money transmitter, filed under business services.
    [CIK.PAYS]: { sic: '7389', sicDescription: 'Services-Business Services, NEC' },
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    requests.push({ url, ua: new Headers(init?.headers).get('user-agent') ?? '', at: t });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    if (url.hostname === 'www.sec.gov' && url.pathname === '/files/company_tickers.json') return json(TICKERS);
    if (url.hostname === 'data.sec.gov') {
        const m = url.pathname.match(/^\/api\/xbrl\/frames\/us-gaap\/([^/]+)\/USD\/([^/]+)\.json$/);
        if (m) {
            const rows = FRAMES[m[1]]?.[m[2]];
            return rows
                ? json({ data: rows.map(([cik, val, end, accn]) => ({ cik, val, end, accn })) })
                : json({ message: 'not found' }, 404);
        }
        const facts = url.pathname.match(/^\/api\/xbrl\/companyfacts\/CIK(\d{10})\.json$/);
        if (facts && FAILING.has(Number(facts[1]))) return json({ message: 'unavailable' }, 503);
        if (facts) return FACTS[Number(facts[1])] ? json(FACTS[Number(facts[1])]) : json({ message: 'not found' }, 404);
        const sub = url.pathname.match(/^\/submissions\/CIK(\d{10})\.json$/);
        if (sub && FAILING_SUBMISSIONS.has(Number(sub[1]))) return json({ message: 'unavailable' }, 503);
        if (sub) return SUBMISSIONS[Number(sub[1])] ? json(SUBMISSIONS[Number(sub[1])]) : json({ message: 'not found' }, 404);
        return json({ message: 'not found' }, 404);
    }
    if (url.hostname === 'finnhub.io') {
        // As the real service answers a key it does not know.
        if (url.searchParams.get('token') !== 'test-key') return json({ error: 'Invalid API key.' }, 401);
        const sym = url.searchParams.get('symbol') ?? '';
        const f = FH[sym] ?? (/^Q\d+$/.test(sym) ? { quote: quote(20, 0.1), metric: { '52WeekHigh': 30, '52WeekLow': 19, '13WeekPriceReturnDaily': 1, '26WeekPriceReturnDaily': 2 } } : null);
        if (url.pathname === '/api/v1/quote') return json(f?.quote ?? { c: 0, d: null, dp: null, t: 0 });
        if (url.pathname === '/api/v1/stock/metric') return json({ metric: f?.metric ?? {} });
        return json([], 200);
    }
    return json({ message: 'unexpected' }, 404);
}) as typeof fetch;

(async () => {
    console.log('\nSEC: the arithmetic, and where every figure came from\n' + '─'.repeat(78));

    reset();
    {
        const { found } = await fundamentalsFor(['CNI', 'aapl']);
        const cni = found.find((f) => f.ticker === 'CNI')!;
        const aapl = found.find((f) => f.ticker === 'AAPL')!;

        ok(near(cni.freeCashFlow, 1.7e9), 'free cash flow is cash from operations minus capex', '$5.1B − $3.4B');
        ok(near(cni.debt?.value, 19.1e9) && near(cni.netDebt, 18.7e9), 'debt adds current and noncurrent; cash comes off');
        ok(near(cni.netDebtToFcf, 11), 'leverage in years of free cash flow', '11.0 years');
        ok(near(cni.revenueGrowth, 12.4 / 12.0 - 1), 'revenue growth uses one concept for both years', '+3.3%');
        ok(aapl.revenue?.concept.endsWith('RevenueFromContractWithCustomerExcludingAssessedTax') === true, 'a filer using the other revenue concept is still found');
        ok(aapl.quarterlyGrowth?.accelerating === true && cni.quarterlyGrowth?.accelerating === false, 'sales acceleration is read from the quarters', 'AAPL +11.8% after +4.8%');
        ok(requests.filter((r) => r.url.hostname.endsWith('sec.gov')).every((r) => r.ua === 'Delphi test@example.com'), 'every SEC request names its contact', 'SEC refuses anonymous ones');
        ok(
            filingUrl(16868, '0000016868-26-000010') === 'https://www.sec.gov/Archives/edgar/data/16868/000001686826000010/0000016868-26-000010-index.htm',
            'each figure links to the filing it came from'
        );
    }
    {
        // Some filers report capex as a negative outflow. It must still come off.
        const base = { cik: 1, ticker: 'X', name: 'X', currency: 'USD', taxonomy: 'us-gaap' as const };
        const fig = (value: number, end = '2025-12-31') => ({ value, end, accn: 'x', concept: 'c' });
        const a = derive({ ...base, operatingCashFlow: fig(5.1e9), capex: fig(3.4e9) });
        const b = derive({ ...base, operatingCashFlow: fig(5.1e9), capex: fig(-3.4e9) });
        ok(near(a.freeCashFlow, 1.7e9) && near(b.freeCashFlow, 1.7e9), 'capex is subtracted whichever sign it is filed with');

        // Both halves of free cash flow, and its margin, from one year.
        const c = derive({ ...base, operatingCashFlow: fig(5.1e9), capex: fig(3.4e9, '2024-12-31') });
        ok(c.freeCashFlow === undefined, "one year's cash flow less another year's capex is never computed");
        const d = derive({ ...base, revenue: fig(20e9, '2024-12-31'), operatingCashFlow: fig(5.1e9), capex: fig(3.4e9) });
        ok(near(d.freeCashFlow, 1.7e9) && d.fcfMargin === undefined, "nor a margin over another year's revenue");
    }
    {
        const tm = fromCompanyFacts({ cik: CIK.TM, ticker: 'TM', name: 'TOYOTA MOTOR CORP/' }, TM_FACTS)!;
        ok(tm.taxonomy === 'ifrs-full' && tm.currency === 'JPY', 'an IFRS filer is read in its own currency', 'Toyota, in yen');
        ok(near(tm.revenue?.value, 48e12), 'a quarter is never mistaken for a year');
        ok(near(tm.freeCashFlow, 1.6e12), 'and its free cash flow is computed the same way');

        const { found } = await fundamentalsFor(['TM']);
        ok(found[0]?.currency === 'JPY', 'fundamentalsFor falls back to it when frames miss a filer');
    }
    {
        const nok = fromCompanyFacts({ cik: CIK.NOK, ticker: 'NOK', name: 'Nokia Corp' }, NOK_FACTS)!;
        ok(
            nok.revenue?.end === '2025-12-31' && nok.revenue.concept === 'ifrs-full:RevenueFromContractsWithCustomers',
            'the newest revenue concept wins, not the first listed',
            'Nokia: 2025, not 2017'
        );
        ok(near(nok.revenueGrowth, 19.9 / 19.2 - 1), 'and growth compares that concept with itself', '+3.6%');
        ok(near(nok.freeCashFlow, 1.8e9) && nok.currency === 'EUR', "Nokia's capex, under IFRS's long name, comes off", '€2.4B − €0.6B');
        ok(near(nok.debt?.value, 3.4e9), 'total borrowings win over the noncurrent line');

        const hmc = fromCompanyFacts({ cik: CIK.HMC, ticker: 'HMC', name: 'HONDA MOTOR CO LTD' }, HMC_FACTS)!;
        ok(hmc.taxonomy === 'ifrs-full' && hmc.revenue?.end === '2025-03-31', 'newer IFRS figures beat older US GAAP ones', 'Honda: FY to 2025-03, not 2014');
        ok(hmc.capex === undefined && hmc.freeCashFlow === undefined, 'capex from another year is never used', 'only the year before\'s on file');
        ok(hmc.debt === undefined && hmc.netDebt === undefined, 'a 2014 debt figure never meets 2025 cash flow');
    }
    reset();
    {
        const before = requests.length;
        const prod = (await fundamentalsFor(['PROD'])).found[0];
        ok(
            near(prod?.freeCashFlow, 110e6) && prod?.capex?.concept === 'us-gaap:PaymentsToAcquireProductiveAssets',
            'capex filed as "productive assets" is read from the frames',
            'the cash flow\'s own year, not an older concept\'s'
        );
        ok(!requests.slice(before).some((r) => r.url.pathname.includes('companyfacts')), 'and costs no extra request');

        const gap = (await fundamentalsFor(['GAP1'])).found[0];
        ok(near(gap?.freeCashFlow, 40e6), "when the frames lack capex, the company's own filings supply it");
        ok(near(gap?.quarterlyGrowth?.latest, 90 / 70 - 1), 'keeping the quarterly growth only the frames carry');
        ok(near(gap?.debt?.value, 110e6) && gap?.debt?.figures.length === 2, 'the newest debt, with its current portion added', 'not a 2019 total');
    }
    reset();
    {
        FAILING.add(CIK.GAP);
        const kept = (await fundamentalsFor(['GAP1', 'CNI'])).found;
        FAILING.delete(CIK.GAP);
        ok(
            kept.some((f) => f.ticker === 'GAP1' && f.revenue !== undefined) && kept.some((f) => f.ticker === 'CNI'),
            'an SEC error on a fact set keeps the reading in hand',
            'and the rest of the call'
        );
    }
    {
        const r = await fundamentalsFor(['OLD', 'NOK']);
        ok(
            r.stale.length === 1 && r.stale[0].ticker === 'OLD' && r.stale[0].latestEnd === '2019-12-31',
            'figures over two years old are reported as out of date',
            'FY2019'
        );
        ok(!r.found.some((f) => f.ticker === 'OLD') && r.found.some((f) => f.ticker === 'NOK'), 'never as current fundamentals');

        const [tool] = toolsForChannels(['sec']).filter((x) => x.declaration.name === 'sec_fundamentals');
        const out = await tool.execute({ tickers: ['OLD'] });
        ok(/OLD .*2019-12-31.*not current/.test(out.content), 'and the agent is told so, in as many words');

        const ttm = (await fundamentalsFor(['TTMX'])).found[0];
        ok(near(ttm?.freeCashFlow, -10e9) && ttm?.fcfMargin === undefined, 'the newest twelve months of cash flow, and no margin across periods', 'as Amazon files');
        const said = (await tool.execute({ tickers: ['TTMX'] })).content;
        ok(/free cash flow \S+ \(12 months to 2026-06-30\)/.test(said), 'and the agent is told which twelve months');
        ok(/debt: no figure in SEC data/.test(said), 'a missing debt figure is said, not skipped', 'as at Ford and PepsiCo');
    }
    {
        ok(describeFiling('8-K', '2.02,9.01') === 'results of operations (earnings)', '8-K items read as words', '2.02');
        ok(describeFiling('8-K', '5.02,7.01') === 'director or officer change; Regulation FD disclosure', 'several items, in order');
        const { filings } = await recentFilings(['CNI'], 30);
        ok(filings.length === 2 && filings[0].what === 'results of operations (earnings)', 'only filings inside the window', '2 of 3');
    }
    {
        const leaders = await qualityLeaders('value');
        const syms = leaders.map((l) => l.fundamentals.ticker);
        ok(syms.includes('AAPL'), 'a cash-rich, lightly indebted company leads on value');
        ok(syms.includes('BUYB'), 'negative equity from buybacks is not treated as distress', 'judged on years of cash flow instead');
        ok(!syms.includes('CNI'), 'debt of eleven years of free cash flow is not "manageable"');
        ok(!syms.includes('TINY'), 'a company too small to screen without prices is left out');
        ok(!syms.includes('GONE'), 'a company that stopped filing is no leader', 'last figures mid-2024');
        ok(!syms.includes('BANK'), 'a bank is no value leader, however its cash flow reads', 'a 63% "margin" of deposits');
        ok(!syms.includes('PAYS'), 'nor a company whose free cash flow exceeds its sales', 'customer money, as at Wise');
        ok(leaders.find((l) => l.fundamentals.ticker === 'AAPL')?.fundamentals.industry?.sic === 3571, 'each leader carries its industry');
    }

    console.log('\nSEC: industries where free cash flow does not apply\n' + '─'.repeat(78));

    {
        ok([6021, 6199, 6211, 6331, 6324, 6798].every((s) => financialKind(s) !== null), 'banks, lenders, brokers, insurers and REITs are recognised', 'SIC 6021 6199 6211 6331 6324 6798');
        ok([6200, 6282, 6411, 6500, 3571, 4011].every((s) => financialKind(s) === null), 'exchanges, asset managers and insurance brokers are not', 'nor anyone else');
    }
    reset();
    {
        const [tool] = toolsForChannels(['sec']).filter((x) => x.declaration.name === 'sec_fundamentals');
        const said = (await tool.execute({ tickers: ['BANK'] })).content;
        ok(
            /industry: National Commercial Banks \(SIC 6021\) — a bank or lender: .*free cash flow does not measure it/.test(said),
            "a bank's fundamentals say what it is",
            'and what that means for its cash flow'
        );
        const pays = (await tool.execute({ tickers: ['PAYS'] })).content;
        ok(/more than its sales: customer money or one-offs/.test(pays), 'cash flow larger than sales is called what it is');
    }
    reset();
    {
        FAILING_SUBMISSIONS.add(CIK.AAPL);
        const syms = (await qualityLeaders('value')).map((l) => l.fundamentals.ticker);
        FAILING_SUBMISSIONS.delete(CIK.AAPL);
        ok(syms.includes('AAPL'), 'a failed industry lookup never leaves a company out');
    }

    console.log('\nFinnhub: pacing, caching, and the free tier\'s limits\n' + '─'.repeat(78));

    reset();
    {
        const r = await snapshots(['AAPL']);
        const s = r.found[0];
        ok(near(s.aboveLow, 224.58 / 212 - 1), 'distance from the 52-week low is computed here', '5.9% above');
        ok(near(s.volumeRatio, 1.2), 'volume against its norm is a ratio, unit-free', '1.20×');

        const before = requests.length;
        await snapshots(['AAPL']);
        ok(requests.length === before, 'asking again costs no calls', 'cached');
    }
    reset();
    {
        // Only this block's requests: reset() rewinds the clock, so earlier
        // blocks' calls would otherwise land inside the same "minute".
        const first = requests.length;
        const many = Array.from({ length: 35 }, (_, i) => `Q${i + 1}`);
        const r = await snapshots(many);
        ok(r.found.length === MAX_TICKERS_PER_CALL, 'at most thirty stocks per call', `${many.length} asked`);

        const calls = requests.slice(first).filter((q) => q.url.hostname === 'finnhub.io').map((q) => q.at);
        let worst = 0;
        for (const start of calls) worst = Math.max(worst, calls.filter((x) => x >= start && x < start + 60_000).length);
        ok(worst <= 55, 'never more than 55 calls in any minute', `${worst} at most`);
        ok(slept > 0, 'and it waits rather than exceeding it');
    }
    reset();
    {
        delete process.env.FINNHUB_API_KEY;
        ok(toolsForChannels(['finnhub']).length === 0, 'without a key, no price tools are handed out');
        const r = await snapshots(['AAPL']);
        ok(r.found.length === 0 && /FINNHUB_API_KEY/.test(r.unavailable[0]?.why ?? ''), 'and a direct call says why');
    }
    reset();
    {
        // A refused key is diagnosed from its shape alone, never its content.
        ok(keyShapeProblem('"c1a2b3c4d5e6f7g8h9i0"')?.includes('quotes') === true, 'a key saved inside quotes is caught', 'by its shape alone');
        ok(keyShapeProblem('FINNHUB_API_KEY=c1a2b3c4d5e6f7g8h9i0')?.includes('variable name') === true, 'so is a whole .env line pasted as the value');
        ok(keyShapeProblem('sandbox_c1a2b3c4d5e6f7g8h9i0')?.includes('sandbox') === true, 'and the sandbox key');
        ok(keyShapeProblem(' c1a2b3c4d5e6f7g8h9i0\n') === null, 'a well-formed key raises nothing', 'spaces around it are trimmed');

        // What pasting brings along, none of which a key contains, is removed before use.
        const k = 'c1a2b3c4d5e6f7g8h9i0';
        ok(
            [`${k}​`, `"${k}".`, `FINNHUB_API_KEY=${k}`, `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${k}`, ` ${k} `].every((v) => cleanKey(v) === k),
            'paste leftovers around a key are removed',
            'invisible characters, quotes, a full stop, NAME=, a docs link'
        );
        ok(cleanKey(k) === k && cleanKey('abc-def') === 'abc-def', 'and nothing inside a key is touched');

        process.env.FINNHUB_API_KEY = '"test-key"​';
        const tidy = await checkFinnhubHealth();
        ok(tidy.ok && /extra characters around it, removed before use/.test(tidy.detail ?? ''), 'a key saved with leftovers still works', 'and the check says to tidy it');

        reset();
        process.env.FINNHUB_API_KEY = 'abcdefghij-klmnopqrst';
        const h = await checkFinnhubHealth();
        ok(
            !h.ok && /rejected \(401\): the saved value has 20 letters and digits plus 1 other character \(a dash or underscore in the middle\)/.test(h.detail ?? ''),
            'what cannot be removed is described, not shown',
            'kind and place of each odd character'
        );
    }

    console.log('\nToronto listings: only through a US listing that is provably the same company\n' + '─'.repeat(78));

    reset();
    {
        ok(tsxBase('CNR.TO') === 'CNR' && tsxBase('TSX:CNR') === 'CNR' && tsxBase('cnr:ca') === 'CNR', 'Toronto symbols are recognised however written');
        ok(tsxBase('AAPL') === null, 'a US symbol is left alone');

        const cnr = await resolveListing('CNR.TO');
        ok(cnr.us === 'CNI', 'CNR.TO reaches CN Rail through CNI', cnr.note?.slice(0, 40));

        const bb = await resolveListing('BB.TO');
        ok(bb.us === null && /not used/.test(bb.note ?? ''), 'a mapping SEC\'s records contradict is rejected', 'BB is Blue Bird here, not BlackBerry');

        const ac = await resolveListing('AC.TO');
        ok(ac.us === null && /web search/i.test(ac.note ?? ''), 'Air Canada is not borrowed from AC in New York', 'Toronto-only: web search');

        delete process.env.SEC_CONTACT;
        const unverified = await resolveListing('CNR.TO');
        ok(unverified.us === null, 'without SEC to confirm it, no mapping is trusted');
        ok(toolsForChannels(['sec']).length === 0, 'and without a contact address, no SEC tools are handed out');
    }

    console.log('\nPublished lists: only what the search actually read\n' + '─'.repeat(78));

    {
        const parsed = {
            sources: [
                { name: 'MarketBeat', url: 'https://www.marketbeat.com/market-data/52-week-lows/', asOf: '2026-09-25', symbols: ['AAPL', 'NASDAQ:CNI', 'ZZZZ'] },
                { name: 'A list it remembered', url: 'https://example.com/old-list', symbols: ['BUYB'] },
                { name: 'Barchart', url: 'https://www.barchart.com/stocks/highs-lows/lows?page=2', symbols: ['AAPL'] },
            ],
        };
        const citations = ['https://www.marketbeat.com/market-data/52-week-lows/', 'https://www.barchart.com/stocks/highs-lows/lows'];
        const v = vetLists(parsed, citations, 'us', new Set(['AAPL', 'CNI', 'BUYB']));

        ok(v.sources.length === 2 && v.uncited === 1, 'a source the search never returned is dropped', 'with what it named');
        ok(v.unknown.includes('ZZZZ') && !v.sources[0].symbols.includes('ZZZZ'), 'a US symbol SEC has never heard of is dropped');
        ok(v.sources[1].url === 'https://www.barchart.com/stocks/highs-lows/lows', 'the cited page is what gets cited', 'not the model\'s version of its URL');
        const agreed = tally(v.sources);
        ok(agreed[0].symbol === 'AAPL' && agreed[0].sources === 2, 'agreement across sources is counted', 'AAPL on 2 lists');

        // Seen live: a source named for 52-week lows, matched to a different
        // page on the same site. With several pages there, it must not guess.
        const ambiguous = vetLists(
            { sources: [{ name: 'MarketBeat alerts', url: 'https://www.marketbeat.com/instant-alerts/some-alert/', symbols: ['AAPL'] }] },
            ['https://www.marketbeat.com/stocks/monday-pick/', 'https://www.marketbeat.com/market-data/earnings/'],
            'us',
            new Set(['AAPL'])
        );
        ok(ambiguous.sources.length === 0 && ambiguous.uncited === 1, 'never guesses between several pages on one site', 'monday-pick is not a lows list');

        // Seen live on a Globe and Mail list: its own way of writing TSX symbols.
        const globe = ['KNT-T', 'AP-UN-T', 'T-T', 'RCI-B-T', 'AP-UN.TO', 'FVI-X'].map(normalizeTsxSymbol).join(',');
        ok(globe === 'KNT.TO,AP.UN.TO,T.TO,RCI.B.TO,AP.UN.TO,FVI.V', 'Toronto symbols read however a site writes them', 'KNT-T → KNT.TO');

        const ca = vetLists({ sources: [{ name: 'TMX Money', url: 'https://money.tmx.com/x', symbols: ['CNR', 'SHOP.TO', 'TSX:ENB'] }] }, ['https://money.tmx.com/x'], 'canada', null);
        ok(ca.sources[0].symbols.join(',') === 'CNR.TO,SHOP.TO,ENB.TO', 'Toronto symbols are normalised', 'CNR, TSX:ENB → .TO');
    }

    console.log('\nThe value screen\n' + '─'.repeat(78));

    reset();
    {
        const r = await screenValue(['CNR.TO', 'AAPL', 'AC.TO']);
        const stages = r.stages.map((s) => s.count).join(' → ');
        ok(r.rows.map((x) => x.symbol).join(',') === 'AAPL', 'only what passes every test is ranked', 'AAPL');
        ok(stages === '4 → 3 → 2 → 1 → 1', 'each stage\'s count is reported', stages);
        ok(r.unscreened.some((u) => u.symbol === 'AC.TO'), 'a Toronto-only name is listed, not ranked');
        ok(r.rows[0].origins.includes('named by the agent') && r.rows[0].origins.includes('SEC quality leader'), 'and each row says where it came from');

        const [tool] = toolsForChannels(['sec']).filter((x) => x.declaration.name === 'screen_value');
        const out = await tool.execute({ candidates: ['CNR.TO', 'AAPL', 'AC.TO'] });
        ok(out.content.startsWith('HOW THIS VALUE SCREEN WAS BUILT — emulated'), 'the report opens by saying how it was built');
        ok(/NOT SCREENED BY THE NUMBERS \(1\)/.test(out.content), 'and names what it could not screen');
        ok(
            out.locators.some((l) => l.kind === 'series' && l.seriesId === 'FINNHUB:AAPL') &&
                out.locators.some((l) => l.kind === 'url' && l.url.includes('/320193/')),
            'every ranked figure carries a citation',
            'a price and a filing'
        );
    }
    reset();
    {
        delete process.env.FINNHUB_API_KEY;
        const r = await screenValue(['AAPL', 'CNI']);
        ok(!r.priced && r.notChecked.some((n) => /no Finnhub key/.test(n)), 'without prices it says the 52-week test was skipped');
        ok(r.rows.some((x) => x.symbol === 'AAPL') && !r.rows.some((x) => x.symbol === 'CNI'), 'and still applies the fundamentals');
    }
    reset();
    {
        const r = await screenValue(['OLD']);
        const old = r.unscreened.find((u) => u.symbol === 'OLD');
        ok(/2019-12-31, too old to screen on/.test(old?.why ?? ''), 'a company with out-of-date filings is listed, not ranked', 'and says why');
    }
    reset();
    {
        const r = await screenValue(['BANK', 'PAYS', 'AAPL']);
        const bank = r.unscreened.find((u) => u.symbol === 'BANK');
        ok(
            /^a bank or lender, National Commercial Banks \(SIC 6021\): free cash flow does not measure it$/.test(bank?.why ?? '') &&
                !r.rows.some((x) => x.symbol === 'BANK') &&
                r.rows.some((x) => x.symbol === 'AAPL'),
            'a bank named as a candidate is listed, never ranked',
            'Apple still ranks'
        );
        const pays = r.unscreened.find((u) => u.symbol === 'PAYS');
        ok(/^free cash flow of \d+% of sales: customer money/.test(pays?.why ?? ''), 'so is a company whose cash flow exceeds its sales', pays?.why.slice(0, 32));
        ok(r.notChecked.some((n) => n.startsWith('banks, brokers, insurers, REITs, and companies whose free cash flow exceeds')), 'and the screen states the rule');
    }
    reset();
    {
        delete process.env.FINNHUB_API_KEY;
        const r = await screenValue(['PROD']);
        const prod = r.rows.find((x) => x.symbol === 'PROD');
        ok(prod?.flags.includes('no debt figure in SEC data — leverage not checked') === true, 'unknown debt passes only with a flag saying so');
    }
    {
        // Currencies: Toyota's cash flow is in yen; its market value in dollars.
        const tm = { freeCashFlow: 1.6e12, currency: 'JPY' } as Fundamentals;
        const usd = { freeCashFlow: 5e9, currency: 'USD' } as Fundamentals;
        const snap = { marketCapM: 250_000 } as never;
        ok(fcfYieldOf(tm, snap) === undefined, 'no yield from yen of cash flow over dollars of value');
        ok(near(fcfYieldOf(usd, snap), 0.02), 'but one in a single currency is computed', '2.0%');
    }
    reset();
    {
        addSynthetic();
        delete process.env.FINNHUB_API_KEY;
        const r = await screenValue(SYNTH.map((s) => s.ticker));
        ok(r.rows.length === 20, 'never more than twenty shown', `${r.stages[r.stages.length - 2].count} passed`);
        ok(r.stages[0].count === 40, 'and never more than forty considered');
    }

    console.log('\nThe momentum screen\n' + '─'.repeat(78));

    reset();
    {
        const r = await screenMomentum(['CNR.TO', 'AAPL', 'HOT']);
        const syms = r.rows.map((x) => x.symbol);
        ok(syms.includes('AAPL') && syms.includes('HOT') && !syms.includes('CNI'), 'only stocks up over both 13 and 26 weeks', 'CN Rail is down');
        ok(r.rows.find((x) => x.symbol === 'HOT')?.flags.some((f) => /extended/.test(f)) === true, 'an outsized run is flagged as extended', '+75% in 26 weeks');
        ok(r.rows.find((x) => x.symbol === 'AAPL')?.flags.includes('sales growth accelerating') === true, 'accelerating sales are credited and said');
    }

    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error('THREW:', e);
    process.exit(1);
});

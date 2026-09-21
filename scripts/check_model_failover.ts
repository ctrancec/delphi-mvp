/**
 * Prove Delphi tells the truth about why a model refused, and stops asking
 * once the answer cannot change.
 *
 * This is the check that would have caught the failure it was written for. The
 * free tier counts requests per model per day; a spent allowance and a busy
 * server both arrive as `429 RESOURCE_EXHAUSTED`, and treating them alike cost
 * a task 167 seconds of backoff against five models that had all already
 * refused — each retry spending another request from the thing that had run
 * out. It then reported the *last* model's `404` as the cause, so the log said
 * "model not found" about a quota problem.
 *
 * The bodies below are real, captured from the live API.
 */

import {
    callWithFallback,
    classifyRefusal,
    exhaustedModels,
    forgetExhaustedModels,
    MODEL_FALLBACKS,
    ModelQuotaError,
    type Refusal,
} from '../src/lib/llm/gemini';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(46)}${note ? D + note + RS : ''}`);
};

// --- Real error bodies -----------------------------------------------------

const DAILY_QUOTA = JSON.stringify({
    error: {
        code: 429,
        message:
            'You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits',
        status: 'RESOURCE_EXHAUSTED',
        details: [
            {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [
                    {
                        quotaMetric:
                            'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                        quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                    },
                ],
            },
        ],
    },
});

const PER_MINUTE = JSON.stringify({
    error: {
        code: 429,
        message: 'You exceeded your current quota.',
        status: 'RESOURCE_EXHAUSTED',
        details: [
            {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
            },
        ],
    },
});

const SATURATED = JSON.stringify({
    error: {
        code: 503,
        message:
            'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
        status: 'UNAVAILABLE',
    },
});

const RETIRED = JSON.stringify({
    error: {
        code: 404,
        message:
            'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash instead.',
        status: 'NOT_FOUND',
    },
});

const BAD_REQUEST = JSON.stringify({
    error: { code: 400, message: 'Invalid JSON payload received.', status: 'INVALID_ARGUMENT' },
});

// --- Classification --------------------------------------------------------

console.log('\nWhat kind of refusal was that\n' + '─'.repeat(64));

const cases: [string, string, Refusal][] = [
    ['daily allowance spent', DAILY_QUOTA, 'quota'],
    ['per-minute rate limit', PER_MINUTE, 'unavailable'],
    ['model saturated (503)', SATURATED, 'unavailable'],
    ['model retired for this key (404)', RETIRED, 'model_gone'],
    ['our own bad request (400)', BAD_REQUEST, 'fatal'],
    ['socket hung up', 'fetch failed: ECONNRESET', 'unavailable'],
];

for (const [label, body, want] of cases) {
    const got = classifyRefusal(new Error(body));
    ok(got === want, label, `${got}${got === want ? '' : ` (wanted ${want})`}`);
}

// A per-day quota must never be read as something waiting will fix — that is
// the specific mistake that burned the allowance faster the emptier it got.
ok(
    classifyRefusal(new Error(DAILY_QUOTA)) !== 'unavailable',
    'a spent allowance is never retried',
    'no backoff against a refusal that cannot change'
);

// --- Walking the chain -----------------------------------------------------

const CHAIN = ['gemini-3.8-flash', ...MODEL_FALLBACKS['gemini-3.8-flash']];
const reply = { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } as never;

type Reply = 'quota' | 'gone' | 'busy' | 'bad' | 'ok';

async function walk(respond: (model: string) => Reply) {
    const tried: string[] = [];
    try {
        const out = await callWithFallback('gemini-3.8-flash', async (m) => {
            tried.push(m);
            switch (respond(m)) {
                case 'quota':
                    throw new Error(DAILY_QUOTA);
                case 'gone':
                    throw new Error(RETIRED);
                case 'busy':
                    throw new Error(SATURATED);
                case 'bad':
                    throw new Error(BAD_REQUEST);
                default:
                    return reply;
            }
        });
        return { tried, servedBy: out.servedBy, error: null as unknown };
    } catch (err) {
        return { tried, servedBy: null, error: err };
    }
}

(async () => {
    console.log('\nWalking the fallback chain\n' + '─'.repeat(64));

    forgetExhaustedModels();
    let r = await walk((m) => (m === CHAIN[0] || m === CHAIN[1] ? 'quota' : 'ok'));
    ok(r.servedBy === CHAIN[2], 'steps past spent models to one that answers', String(r.servedBy));
    ok(r.tried.length === 3, 'asks each model once, not four times', `${r.tried.length} calls`);

    // The same process runs several tasks. The second must not rediscover the
    // first's dead ends by spending more requests on them.
    r = await walk((m) => (m === CHAIN[0] || m === CHAIN[1] ? 'quota' : 'ok'));
    ok(r.tried[0] === CHAIN[2], 'remembers what already refused', `started at ${r.tried[0]}`);
    ok(
        exhaustedModels().includes(CHAIN[0]) && exhaustedModels().includes(CHAIN[1]),
        'reports the spent models for diagnostics',
        exhaustedModels().join(', ')
    );

    forgetExhaustedModels();
    r = await walk(() => 'quota');
    ok(
        r.error instanceof ModelQuotaError,
        'whole chain spent raises a quota error',
        (r.error as Error)?.name
    );
    ok(
        /free tier|billing|daily reset/i.test((r.error as Error)?.message ?? ''),
        'and says what to actually do about it'
    );

    // The failure this was written for: a retired model at the end of the
    // chain must not become the story, and must not stop the chain either.
    forgetExhaustedModels();
    r = await walk((m) => (m === CHAIN[0] ? 'gone' : 'ok'));
    ok(r.servedBy === CHAIN[1], 'a retired model is skipped, not fatal', String(r.servedBy));
    ok(!CHAIN.includes('gemini-2.5-flash'), 'the retired model is out of the chain');

    // A busy model is worth waiting for, so this one does retry — and still
    // moves on rather than giving up.
    forgetExhaustedModels();
    r = await walk((m) => (m === CHAIN[0] ? 'busy' : 'ok'));
    ok(r.servedBy === CHAIN[1], 'a saturated model degrades to the next', String(r.servedBy));

    // A quota window rolls over at midnight Pacific and a warm instance can
    // outlive that, so the memory of a refusal has to expire — otherwise the
    // process keeps skipping models that came back hours ago.
    forgetExhaustedModels();
    await walk((m) => (m === CHAIN[0] ? 'quota' : 'ok'));
    const remembered = exhaustedModels().includes(CHAIN[0]);
    const real = Date.now;
    Date.now = () => real() + 31 * 60 * 1000;
    const forgotten = !exhaustedModels().includes(CHAIN[0]);
    const recovered = await walk(() => 'ok');
    Date.now = real;
    ok(remembered && forgotten, 'a refusal is remembered, then expires', 'after 30 minutes');
    ok(recovered.servedBy === CHAIN[0], 'and the model is asked again', String(recovered.servedBy));

    // A malformed request fails the same way everywhere, so trying five models
    // just makes the same mistake five times.
    forgetExhaustedModels();
    r = await walk(() => 'bad');
    ok(r.tried.length === 1, 'our own bad request stops immediately', `${r.tried.length} call`);
    ok(!(r.error instanceof ModelQuotaError), 'and is not dressed up as a quota problem');

    forgetExhaustedModels();
    console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
    process.exit(failed ? 1 : 0);
})();

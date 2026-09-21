/**
 * The L.L.R. board's reference library.
 *
 * Without this, every legal finding is the model's recall of law it read
 * during training — which is unverifiable, silently out of date, and stated
 * with exactly the same confidence whether it is right or not. Stored sources
 * turn a finding into something you can click.
 *
 * **What is in scope: free and lawfully redistributable only.** Primary law is
 * public domain in the US; Canadian and UK legislation carry open licences;
 * regulator guidance is published to be read. Platform terms are fetched as
 * published, because the question "does this break YouTube's rules" cannot be
 * answered from memory when the rules change quarterly.
 *
 * **What is explicitly out of scope:** copyrighted legal textbooks,
 * practitioner handbooks, and paywalled databases. A compliance system built
 * on infringing copies is self-defeating, and no amount of usefulness fixes
 * that.
 *
 * **Relevance over volume.** The board does not need all of case law. It needs
 * the material covering what the CHO actually does: gaming clips and travel
 * footage with music and likeness in them, social publishing with disclosure
 * obligations, and market research that must stay on the commentary side of
 * the line between commentary and advice. Every URL below was fetched and
 * confirmed to return readable text.
 */

export interface LegalSource {
    title: string;
    /** 'US', 'CA', 'UK', 'EU', or 'platform' for terms of service. */
    jurisdiction: string;
    category: 'statute' | 'regulation' | 'case' | 'guidance' | 'tos' | 'circular' | 'open-commentary';
    url: string;
    licence: string;
    /**
     * How long before this is considered stale. Platform terms change
     * constantly and a year-old answer about them is actively misleading;
     * statutes move slowly.
     */
    refreshDays: number;
    /** Why this is in the library, in terms of the CHO's actual exposure. */
    why: string;
}

export const LEGAL_SOURCES: LegalSource[] = [
    // --- Copyright. The gaming-clip and travel-footage exposure.
    {
        title: '17 U.S. Code § 107 — Fair use',
        jurisdiction: 'US',
        category: 'statute',
        url: 'https://www.law.cornell.edu/uscode/text/17/107',
        licence: 'Public domain (US federal statute)',
        refreshDays: 365,
        why: 'The four-factor test every "can I use this clip" question runs through.',
    },
    {
        title: '17 U.S. Code § 106 — Exclusive rights in copyrighted works',
        jurisdiction: 'US',
        category: 'statute',
        url: 'https://www.law.cornell.edu/uscode/text/17/106',
        licence: 'Public domain (US federal statute)',
        refreshDays: 365,
        why: 'What rights are being touched at all — reproduction, derivative works, public performance.',
    },
    {
        title: '17 U.S. Code § 512 — DMCA safe harbour and takedowns',
        jurisdiction: 'US',
        category: 'statute',
        url: 'https://www.law.cornell.edu/uscode/text/17/512',
        licence: 'Public domain (US federal statute)',
        refreshDays: 365,
        why: 'What actually happens when a rights holder objects to a published video.',
    },
    {
        title: 'Copyright Act (Canada), R.S.C. 1985, c. C-42',
        jurisdiction: 'CA',
        category: 'statute',
        url: 'https://laws-lois.justice.gc.ca/eng/acts/C-42/FullText.html',
        licence: 'Reproduced under the Justice Laws Website reproduction terms',
        refreshDays: 180,
        why: 'Fair dealing is not fair use. The Canadian test is narrower and enumerated.',
    },
    {
        title: 'Copyright, Designs and Patents Act 1988 (UK)',
        jurisdiction: 'UK',
        category: 'statute',
        url: 'https://www.legislation.gov.uk/ukpga/1988/48/data.xht?view=snippet&wrap=true',
        licence: 'Open Government Licence v3.0',
        refreshDays: 180,
        why: 'Relevant whenever content is published to a UK audience.',
    },

    // --- Advertising disclosure. The social-publishing exposure.
    {
        title: '16 CFR Part 255 — Guides Concerning Use of Endorsements and Testimonials',
        jurisdiction: 'US',
        category: 'regulation',
        url: 'https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=255',
        licence: 'Public domain (US federal regulation)',
        refreshDays: 90,
        why: 'When a post must disclose a material connection, and how prominently.',
    },
    {
        title: "FTC's Endorsement Guides: What People Are Asking",
        jurisdiction: 'US',
        category: 'guidance',
        url: 'https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking',
        licence: 'Public domain (US government work)',
        refreshDays: 90,
        why: 'The regulator answering the practical questions the regulation does not.',
    },
    {
        title: '15 U.S. Code § 45 — Unfair or deceptive acts or practices',
        jurisdiction: 'US',
        category: 'statute',
        url: 'https://www.law.cornell.edu/uscode/text/15/45',
        licence: 'Public domain (US federal statute)',
        refreshDays: 365,
        why: 'The authority behind every disclosure obligation, and what enforcement looks like.',
    },

    // --- Platform terms. These change quarterly, which is why they refresh monthly.
    {
        title: 'YouTube Terms of Service',
        jurisdiction: 'platform',
        category: 'tos',
        url: 'https://www.youtube.com/static?template=terms',
        licence: 'Fetched as published, for compliance reference',
        refreshDays: 30,
        why: 'What may be uploaded, and what rights are granted by uploading it.',
    },
    {
        title: 'YouTube music and copyright policies',
        jurisdiction: 'platform',
        category: 'tos',
        url: 'https://support.google.com/youtube/answer/2797466',
        licence: 'Fetched as published, for compliance reference',
        refreshDays: 30,
        why: 'The actual answer to "can I put this track over my gameplay".',
    },
    {
        title: 'TikTok Terms of Service (US)',
        jurisdiction: 'platform',
        category: 'tos',
        url: 'https://www.tiktok.com/legal/page/us/terms-of-service/en',
        licence: 'Fetched as published, for compliance reference',
        refreshDays: 30,
        why: 'Publishing rights and the licence granted over uploaded content.',
    },

    // --- Privacy. Travel footage has other people in it.
    {
        title: 'PIPEDA — Personal Information Protection and Electronic Documents Act',
        jurisdiction: 'CA',
        category: 'statute',
        url: 'https://laws-lois.justice.gc.ca/eng/acts/P-8.6/FullText.html',
        licence: 'Reproduced under the Justice Laws Website reproduction terms',
        refreshDays: 180,
        why: 'Filming identifiable people, and handling anything personal that comes back from research.',
    },
    {
        title: 'PIPEDA in brief — Office of the Privacy Commissioner',
        jurisdiction: 'CA',
        category: 'guidance',
        url: 'https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/',
        licence: 'Reproduced with permission of the Privacy Commissioner of Canada',
        refreshDays: 180,
        why: 'The readable version, which is usually what a finding should cite.',
    },
    {
        title: "16 CFR Part 312 — Children's Online Privacy Protection Rule",
        jurisdiction: 'US',
        category: 'regulation',
        url: 'https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=312',
        licence: 'Public domain (US federal regulation)',
        refreshDays: 90,
        why: 'Gaming content reaches minors whether or not it is aimed at them.',
    },
];

/** Jurisdictions the board is briefed on, in the order it should prefer them. */
export const DEFAULT_JURISDICTIONS = ['CA', 'US', 'platform'] as const;

export function isStale(retrievedAt: string, refreshDays: number): boolean {
    const age = Date.now() - new Date(retrievedAt).getTime();
    return age > refreshDays * 86_400_000;
}

export function ageInDays(retrievedAt: string): number {
    return Math.floor((Date.now() - new Date(retrievedAt).getTime()) / 86_400_000);
}

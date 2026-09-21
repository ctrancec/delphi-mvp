/**
 * Renders an agent's markdown deliverable.
 *
 * Agents quote pages they fetched from the open web, so their output is not
 * trusted input. This renders to React elements and never to raw HTML —
 * `rehype-raw` is deliberately absent, so an `<img onerror=...>` that rode in
 * on a scraped page is displayed as text rather than executed. react-markdown
 * also filters link protocols by default, which stops `javascript:` hrefs.
 *
 * Keep it that way. The whole library is a viewer for untrusted content.
 */

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

function isExternal(href: string | undefined): boolean {
    return !!href && /^https?:\/\//i.test(href);
}

export function ArtifactMarkdown({
    content,
    className,
}: {
    content: string;
    className?: string;
}) {
    return (
        <div className={cn('text-sm leading-relaxed text-zinc-200', className)}>
            <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h1: ({ children }) => (
                        <h1 className="text-xl font-bold tracking-tight text-white mt-6 mb-3 first:mt-0">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="text-base font-semibold text-white mt-6 mb-2 first:mt-0">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 className="text-sm font-semibold text-zinc-100 mt-5 mb-2 first:mt-0">
                            {children}
                        </h3>
                    ),
                    p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
                    ul: ({ children }) => (
                        <ul className="my-3 ml-5 list-disc space-y-1.5 marker:text-zinc-600">
                            {children}
                        </ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="my-3 ml-5 list-decimal space-y-1.5 marker:text-zinc-600">
                            {children}
                        </ol>
                    ),
                    li: ({ children }) => <li className="pl-1">{children}</li>,
                    strong: ({ children }) => (
                        <strong className="font-semibold text-white">{children}</strong>
                    ),
                    em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
                    blockquote: ({ children }) => (
                        <blockquote className="my-4 border-l-2 border-white/20 pl-4 text-zinc-400 italic">
                            {children}
                        </blockquote>
                    ),
                    hr: () => <hr className="my-6 border-white/10" />,
                    a: ({ href, children }) =>
                        isExternal(href) ? (
                            <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-400 underline underline-offset-2 decoration-sky-400/40 hover:decoration-sky-400 break-words"
                            >
                                {children}
                            </a>
                        ) : (
                            <span className="text-zinc-300">{children}</span>
                        ),
                    code: ({ className: langClass, children }) => {
                        // react-markdown gives fenced blocks a `language-*` class;
                        // inline code has none. That is the only reliable signal.
                        const fenced = /language-/.test(langClass ?? '');
                        if (!fenced) {
                            return (
                                <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-amber-200">
                                    {children}
                                </code>
                            );
                        }
                        return (
                            <code className="block overflow-x-auto font-mono text-xs leading-relaxed text-zinc-200">
                                {children}
                            </code>
                        );
                    },
                    pre: ({ children }) => (
                        <pre className="my-4 overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-4">
                            {children}
                        </pre>
                    ),
                    table: ({ children }) => (
                        <div className="my-4 overflow-x-auto rounded-lg border border-white/10">
                            <table className="w-full text-xs">{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="bg-white/5 text-zinc-400">{children}</thead>
                    ),
                    th: ({ children }) => (
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap">{children}</th>
                    ),
                    td: ({ children }) => (
                        <td className="border-t border-white/10 px-3 py-2 align-top">{children}</td>
                    ),
                }}
            >
                {content}
            </Markdown>
        </div>
    );
}

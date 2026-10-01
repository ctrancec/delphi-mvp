/**
 * Prove every 'use server' file exports nothing but async functions.
 *
 * The server-action compiler registers each export of a 'use server' file as
 * an action, and checks as the module loads that each one is a function. A
 * re-exported type — `export type { Foo }` — survives into that list as a bare
 * name that does not exist at runtime. So the module throws a ReferenceError
 * the first time anything in it is called, and every action in the file fails
 * with it. `next build` passes, and the page still renders: it only shows when
 * someone presses a button. That is how bulk delete took Outputs down.
 *
 * So each 'use server' file is read here, and anything it exports that is not
 * an async function fails. Interfaces and type aliases declared in the file
 * are allowed — the compiler drops those, which the build output confirms.
 *
 * Runs before every build (`prebuild`), so on Vercel a file like that is a
 * failed deploy — the last good one stays up — rather than a broken site. Also
 * `npm run delphi:actions`. No network, no database.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

let failed = 0;
const ok = (cond: boolean, label: string, note = '') => {
    if (!cond) failed++;
    console.log(`  ${cond ? G + '✓' : R + '✗'}${RS} ${label.padEnd(60)}${note ? D + note + RS : ''}`);
};

const ROOT = join(__dirname, '..');

const parse = (text: string, name = 'snippet.ts') =>
    ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

const isAsyncFunction = (node: ts.Node | undefined) =>
    !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && hasModifier(node, ts.SyntaxKind.AsyncKeyword);

/** The directive has to lead the file; one inside a function marks only that function. */
function isUseServer(sf: ts.SourceFile): boolean {
    for (const s of sf.statements) {
        if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) return false;
        if (s.expression.text === 'use server') return true;
    }
    return false;
}

/** Everything the file exports that is not an async function, in words. Empty is clean. */
function problems(sf: ts.SourceFile): string[] {
    const out: string[] = [];

    // Async functions declared here, so `export { name }` can be checked too.
    const asyncHere = new Set<string>();
    for (const s of sf.statements) {
        if (ts.isFunctionDeclaration(s) && s.name && hasModifier(s, ts.SyntaxKind.AsyncKeyword)) asyncHere.add(s.name.text);
        if (ts.isVariableStatement(s)) {
            for (const d of s.declarationList.declarations) {
                if (ts.isIdentifier(d.name) && isAsyncFunction(d.initializer)) asyncHere.add(d.name.text);
            }
        }
    }

    for (const s of sf.statements) {
        const exported = hasModifier(s, ts.SyntaxKind.ExportKeyword);

        if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) continue;

        if (ts.isFunctionDeclaration(s) && exported) {
            if (!hasModifier(s, ts.SyntaxKind.AsyncKeyword)) out.push(`${s.name?.text ?? 'the default export'} is not async`);
        } else if (ts.isVariableStatement(s) && exported) {
            for (const d of s.declarationList.declarations) {
                if (!isAsyncFunction(d.initializer)) out.push(`${d.name.getText(sf)} is not an async function`);
            }
        } else if ((ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && exported) {
            out.push(`${s.name?.text ?? 'the default export'} is a ${ts.isClassDeclaration(s) ? 'class' : 'enum'}`);
        } else if (ts.isExportAssignment(s)) {
            const e = s.expression;
            if (!isAsyncFunction(e) && !(ts.isIdentifier(e) && asyncHere.has(e.text))) out.push('the default export is not an async function');
        } else if (ts.isExportDeclaration(s)) {
            const from = s.moduleSpecifier ? ` from ${s.moduleSpecifier.getText(sf)}` : '';
            const clause = s.exportClause;
            if (!clause) {
                out.push(`export *${from}: there is no telling what that exports`);
            } else if (ts.isNamespaceExport(clause)) {
                out.push(`export * as ${clause.name.text}${from} is an object, not an action`);
            } else if (s.isTypeOnly) {
                out.push(`export type { ${clause.elements.map((e) => e.name.text).join(', ')} }${from} re-exports types — import them from where they are defined`);
            } else {
                for (const el of clause.elements) {
                    const local = (el.propertyName ?? el.name).text;
                    if (el.isTypeOnly) out.push(`export { type ${el.name.text} } re-exports a type — import it from where it is defined`);
                    else if (s.moduleSpecifier) out.push(`${el.name.text} is re-exported${from}; export an action where it is defined`);
                    else if (!asyncHere.has(local)) out.push(`${el.name.text} is not an async function`);
                }
            }
        }
    }
    return out;
}

function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...sourceFiles(path));
        else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(path);
    }
    return found;
}

// ---------------------------------------------------------------------------

console.log('\nThe check itself');
{
    const flagged = (src: string) => problems(parse(`'use server';\n${src}`));

    const incident = flagged(`
        import { purge, type TrashResult } from './deletion';
        import { checkBatch, type BulkResult, type CombinedImpact } from './bulk';
        export type { BulkResult, CombinedImpact, TrashResult };
        export async function purgeAction(id: string) { return purge(id); }
    `);
    ok(incident.length === 1 && /BulkResult, CombinedImpact, TrashResult/.test(incident[0]),
        'catches the type re-export that crashed Outputs', incident[0]);

    ok(flagged(`import type { A } from './a';\nexport { type A };`).length === 1, 'and the inline form, export { type A }');
    ok(flagged(`export type { A } from './a';`).length === 1, 'and the form that re-exports from another file');

    const clean = flagged(`
        export interface Result { ok: boolean }
        export type Decision = 'approved' | 'declined';
        export async function one() {}
        export const two = async () => {};
        async function three() {}
        export { three };
        export default async function four() {}
    `);
    ok(clean.length === 0, 'passes interfaces, type aliases and async functions', clean.join('; '));

    ok(flagged(`export function sync() {}`).length === 1, 'fails a function that is not async');
    ok(flagged(`export const LIMIT = 100;`).length === 1, 'fails a constant');
    ok(flagged(`export enum Kind { A }`).length === 1, 'fails an enum, which is a value at runtime');
    ok(flagged(`export * from './elsewhere';`).length === 1, 'fails export *, which could carry anything');
    ok(flagged(`export { act } from './elsewhere';`).length === 1, 'fails an action re-exported from another file');

    ok(isUseServer(parse(`'use server';\nexport type { A } from './a';`)), 'recognises a use-server file');
    ok(!isUseServer(parse(`import x from 'y';\n'use server';`)), 'not when the directive is not at the top');
    ok(!isUseServer(parse(`'use client';\nexport type { A } from './a';`)), 'and leaves client files alone');
}

console.log('\nThe use-server files in src/');
{
    const files = sourceFiles(join(ROOT, 'src'))
        .map((path) => ({ path, sf: parse(readFileSync(path, 'utf8'), path) }))
        .filter(({ sf }) => isUseServer(sf));

    ok(files.some(({ path }) => path.endsWith(join('src', 'lib', 'delphi', 'trash.ts'))),
        'finds them', `${files.length} files`);

    for (const { path, sf } of files) {
        const found = problems(sf);
        ok(found.length === 0, relative(ROOT, path), found.join('; '));
    }
}

console.log(`\n${failed ? R + failed + ' failed' : G + 'all passed'}${RS}\n`);
process.exit(failed ? 1 : 0);

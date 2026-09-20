/** Short, sortable, dependency-free ids. */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function id(prefix: string): string {
    let tail = ''
    for (let i = 0; i < 10; i++) {
        tail += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    }
    return `${prefix}_${Date.now().toString(36)}${tail}`
}

export function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'project'
}

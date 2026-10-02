'use client';

export function RetryButton() {
    return (
        <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-[#4aa7d8] px-4 py-2 text-sm font-semibold text-[#06111a]"
        >
            Try again
        </button>
    );
}

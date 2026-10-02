'use client';

/**
 * The CHO's own name, set from inside the app.
 *
 * It is what the town calls them and how Diablo addresses them. Left blank,
 * they go by the cast's name for the role again.
 */

import { useState, useTransition } from 'react';
import { Check, Loader2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setNameAction } from '@/app/account/actions';
import { NAME_MAX } from '@/lib/delphi/cho';
import { CHO_NAME } from '@/lib/pixel/cast/names';

export function NameForm({ initial }: { initial: string }) {
    const router = useRouter();
    const [name, setName] = useState(initial);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [pending, startTransition] = useTransition();

    function submit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setDone(null);
        startTransition(async () => {
            const res = await setNameAction(name);
            if (res.ok) {
                setDone(res.message ?? 'Saved.');
                // The chrome and the town read the name from the session: refresh so they see it.
                router.refresh();
            } else {
                setError(res.error ?? 'Could not save it.');
            }
        });
    }

    return (
        <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
                <Label htmlFor="cho-name">Your name</Label>
                <Input
                    id="cho-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={NAME_MAX}
                    autoComplete="name"
                    placeholder={CHO_NAME}
                    className="border-white/10 bg-white/5"
                />
                <p className="text-xs text-muted-foreground">
                    What the town calls you, and how Diablo addresses you. Blank means {CHO_NAME}.
                </p>
            </div>
            {error && (
                <p className="flex items-center gap-2 text-sm text-red-400">
                    <TriangleAlert className="h-4 w-4 shrink-0" /> {error}
                </p>
            )}
            {done && (
                <p className="flex items-center gap-2 text-sm text-emerald-400">
                    <Check className="h-4 w-4 shrink-0" /> {done}
                </p>
            )}
            <Button type="submit" disabled={pending || name.trim() === initial.trim()}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save name
            </Button>
        </form>
    );
}

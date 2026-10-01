import { AgentSprite, SlimeSprite } from '@/components/pixel/agent-sprite';
import { PixelIcon } from '@/components/pixel/pixel-icon';
import { agentForActor, isCho } from '@/lib/delphi/actors';
import type { FloorAgent } from '@/lib/delphi/floor';
import { ActivityLine, type ActivityEvent } from './activity-line';

/**
 * The activity log with a face on every line: the agent who did the thing,
 * the slime when it was the CHO, and the Tempest mark when it was nobody in
 * particular.
 */
export function QuestLog({ events, agents }: { events: ActivityEvent[]; agents: readonly FloorAgent[] }) {
    return (
        <div className="space-y-1 font-mono text-xs">
            {events.map((e) => {
                const actor = e.payload?.actor ?? 'System';
                const who = agentForActor(actor, agents);
                const avatar = who ? (
                    <AgentSprite agent={{ slug: who.slug, name: who.name, avatarSeed: who.avatarSeed }} crop="head" scale={2} label={who.name} />
                ) : isCho(actor) ? (
                    <SlimeSprite scale={2} />
                ) : (
                    <PixelIcon id="mark" className="mb-1 h-5 w-5 text-muted-foreground/40" />
                );
                return <ActivityLine key={e.id} event={e} avatar={avatar} />;
            })}
        </div>
    );
}

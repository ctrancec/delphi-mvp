/**
 * What a state looks like: the pose, how fast it cycles, what floats above
 * the head, and the words for it.
 *
 * States are the ones `floor.ts` derives for an agent. Each sprite computes
 * its frame from the clock rather than counting, so a hundred sprites stay in
 * step with each other and with the wall, and a tab that was hidden resumes
 * at the right frame instead of where it left off. The phase offset, hashed
 * from the agent's seed, is what keeps an office from typing in unison.
 */

import type { Look } from './character';
import { frameCount } from './character';
import { hash } from './residents';
import type { Pose } from './sprites/body';

export type AgentState =
    | 'working'
    | 'waiting_on_you'
    | 'stuck'
    | 'reviewing'
    | 'planning'
    | 'queued'
    | 'done'
    | 'idle'
    | 'asleep'
    | 'off'
    | 'available';

export type Bubble = 'dots' | 'bang' | 'question' | 'star' | 'zzz';

export interface Animation {
    pose: Pose;
    /** Frames per second; 0 holds the first frame. */
    fps: number;
    bubble: Bubble | null;
    /** Plain words, for a label: "waiting on you". */
    label: string;
}

export const STATES: Record<AgentState, Animation> = {
    working: { pose: 'type', fps: 6, bubble: 'dots', label: 'working' },
    waiting_on_you: { pose: 'raise', fps: 2, bubble: 'bang', label: 'waiting on you' },
    stuck: { pose: 'slump', fps: 1, bubble: 'question', label: 'stuck' },
    reviewing: { pose: 'think', fps: 1.5, bubble: 'dots', label: 'reviewing' },
    planning: { pose: 'think', fps: 1.5, bubble: 'dots', label: 'planning' },
    queued: { pose: 'stand', fps: 1, bubble: null, label: 'queued' },
    done: { pose: 'cheer', fps: 3, bubble: 'star', label: 'just finished' },
    idle: { pose: 'idle', fps: 0.8, bubble: null, label: 'idle' },
    asleep: { pose: 'sleep', fps: 0.5, bubble: 'zzz', label: 'asleep' },
    off: { pose: 'sleep', fps: 0, bubble: null, label: 'system off' },
    available: { pose: 'stand', fps: 0.7, bubble: null, label: 'available to hire' },
};

/** 0..1, fixed per seed. */
export function phaseFor(seed: string): number {
    return (hash(seed) % 1000) / 1000;
}

/** The pose a state puts this character in: a character may idle its own way. */
export function poseFor(state: AgentState, look: Look): Pose {
    if (state === 'idle' && look.idlePose) return look.idlePose;
    return STATES[state].pose;
}

export function frameAt(
    state: AgentState,
    look: Look,
    nowMs: number,
    seed: string,
    reducedMotion = false
): { pose: Pose; frame: number } {
    const pose = poseFor(state, look);
    const n = frameCount(pose);
    const { fps } = STATES[state];
    if (reducedMotion || fps === 0 || n < 2) return { pose, frame: 0 };
    return { pose, frame: Math.floor((nowMs / 1000) * fps + phaseFor(seed) * n) % n };
}

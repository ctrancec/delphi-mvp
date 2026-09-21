/** Probe every channel and report what agents can actually reach. */
import { channelHealth } from '../src/lib/channels/registry';

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', RS = '\x1b[0m';

(async () => {
    console.log('\nChannel health\n' + '─'.repeat(50));
    const health = await channelHealth();
    for (const [name, h] of Object.entries(health)) {
        console.log(`  ${h.ok ? G + '✓' : R + '✗'}${RS} ${name.padEnd(14)}${h.detail ? D + h.detail + RS : ''}`);
    }
    const live = Object.values(health).filter((h) => h.ok).length;
    console.log(`\n${live}/${Object.keys(health).length} channels live\n`);
    process.exit(live > 0 ? 0 : 1);
})();

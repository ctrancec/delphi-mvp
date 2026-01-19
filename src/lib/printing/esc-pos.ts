
// ESC/POS Command Constants
const ESC = 0x1B;
const GS = 0x1D;

export const COMMANDS = {
    HW_INIT: [ESC, 0x40], // Initialize printer
    TEXT_FORMAT: {
        TXT_NORMAL: [ESC, 0x21, 0x00], // Normal text
        TXT_2HEIGHT: [ESC, 0x21, 0x10], // Double height text
        TXT_2WIDTH: [ESC, 0x21, 0x20], // Double width text
        TXT_4SQUARE: [ESC, 0x21, 0x30], // Double width & height
        TXT_BOLD_ON: [ESC, 0x45, 1],
        TXT_BOLD_OFF: [ESC, 0x45, 0],
        TXT_ALIGN_LT: [ESC, 0x61, 0], // Left justification
        TXT_ALIGN_CT: [ESC, 0x61, 1], // Centering
        TXT_ALIGN_RT: [ESC, 0x61, 2], // Right justification
    },
    PAPER: {
        PAPER_FULL_CUT: [GS, 0x56, 0x00], // Full cut paper
        PAPER_PART_CUT: [GS, 0x56, 0x01], // Partial cut paper
    }
};

/**
 * Encodes a string into a Uint8Array using a simple encoder.
 * Note: Real-world apps might need encoding libraries for special chars.
 */
function encodeString(text: string): number[] {
    const encoder = new TextEncoder();
    return Array.from(encoder.encode(text));
}

export class ReceiptBuilder {
    private buffer: number[] = [];

    constructor() {
        this.buffer = [...COMMANDS.HW_INIT];
    }

    add(command: number[]) {
        this.buffer.push(...command);
        return this;
    }

    text(text: string) {
        this.buffer.push(...encodeString(text));
        return this;
    }

    textLine(text: string) {
        this.buffer.push(...encodeString(text + '\n'));
        return this;
    }

    feed(lines: number = 1) {
        for (let i = 0; i < lines; i++) {
            this.buffer.push(0x0A); // Line feed
        }
        return this;
    }

    alignCenter() {
        return this.add(COMMANDS.TEXT_FORMAT.TXT_ALIGN_CT);
    }

    alignLeft() {
        return this.add(COMMANDS.TEXT_FORMAT.TXT_ALIGN_LT);
    }

    alignRight() {
        return this.add(COMMANDS.TEXT_FORMAT.TXT_ALIGN_RT);
    }

    bold(on: boolean = true) {
        return this.add(on ? COMMANDS.TEXT_FORMAT.TXT_BOLD_ON : COMMANDS.TEXT_FORMAT.TXT_BOLD_OFF);
    }

    cut() {
        return this.feed(3).add(COMMANDS.PAPER.PAPER_FULL_CUT);
    }

    getData(): Uint8Array {
        return new Uint8Array(this.buffer);
    }
}

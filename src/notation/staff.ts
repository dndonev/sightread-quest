import { type Pitch, diatonicIndex, parsePitch, accidentalAscii } from '../music-theory/pitch';

export type Clef = 'treble' | 'bass';

/** Pitch on the middle (3rd) line of each clef. */
export const MIDDLE_LINE: Record<Clef, Pitch> = {
  treble: parsePitch('B4'),
  bass: parsePitch('D3'),
};

/** Diatonic steps from the middle line (+ up). Lines are even numbers -4..4. */
export function staffStep(p: Pitch, clef: Clef): number {
  return diatonicIndex(p) - diatonicIndex(MIDDLE_LINE[clef]);
}

export function isOnLine(p: Pitch, clef: Clef): boolean {
  return staffStep(p, clef) % 2 === 0;
}

export interface LedgerInfo {
  count: number;
  direction: 'above' | 'below' | 'none';
}

export function ledgerLines(p: Pitch, clef: Clef): LedgerInfo {
  const s = staffStep(p, clef);
  if (s >= 6) return { count: Math.floor((s - 4) / 2), direction: 'above' };
  if (s <= -6) return { count: Math.floor((-s - 4) / 2), direction: 'below' };
  return { count: 0, direction: 'none' };
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/** Plain-language description of where a notehead sits. */
export function describeStaffPosition(p: Pitch, clef: Clef): string {
  const s = staffStep(p, clef);
  const online = s % 2 === 0;
  if (s >= -4 && s <= 4) {
    // Lines numbered from the bottom: step -4 = line 1. Spaces: step -3 = space 1.
    if (online) return `${ORD[(s + 4) / 2]} line`;
    return `${ORD[(s + 3) / 2]} space`;
  }
  if (s === 5) return 'space just above the staff';
  if (s === -5) return 'space just below the staff';
  const above = s > 0;
  const ledger = ledgerLines(p, clef);
  const where = above ? 'above' : 'below';
  if (online) return `${ORD[ledger.count - 1]} ledger line ${where} the staff`;
  return `${above ? 'above' : 'below'} the ${ORD[ledger.count - 1]} ledger line ${where} the staff`;
}

/** VexFlow key string: "c#/4", "bb/3" */
export function vexKey(p: Pitch): string {
  return `${p.letter.toLowerCase()}${accidentalAscii(p.accidental)}/${p.octave}`;
}

/** Which clef fits a pitch best (for grand-staff splitting). */
export function clefForPitch(p: Pitch): Clef {
  return diatonicIndex(p) >= diatonicIndex(parsePitch('C4')) ? 'treble' : 'bass';
}

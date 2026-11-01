import { useStore } from '../state/store';
import { Header } from '../components/ui';
import { NoteHunterGame, NOTE_MODES, type NoteMode } from '../stages/NoteHunterGame';
import { ChordDecoderGame } from '../stages/ChordDecoderGame';
import { SightReadingGame, READING_MODES, type ReadingMode } from '../stages/SightReadingGame';
import { CHORD_MODES, type ChordMode } from '../game-engine/chordDecoder';
import type { Clef } from '../notation/staff';

export function NoteHunterScreen({ level, mode, range, accidentals, clef }: { level: number; mode: NoteMode; range?: string; accidentals?: boolean; clef?: Clef }) {
  const back = useStore((s) => s.back);
  const custom = range ? { customRange: range.split('-') as [string, string], customAccidentals: accidentals, customClef: clef } : undefined;
  return (
    <div>
      <Header title="Note Hunter" subtitle={`Level ${level} · ${NOTE_MODES.find((m) => m.id === mode)?.title ?? mode}${custom ? ' · custom' : ''}`} />
      <NoteHunterGame key={`${level}-${mode}-${range}`} level={level} mode={mode} custom={custom} onExit={back} />
    </div>
  );
}

export function ChordScreen({ level, mode }: { level: number; mode: ChordMode }) {
  const back = useStore((s) => s.back);
  return (
    <div>
      <Header title="Chord Decoder" subtitle={`Level ${level} · ${CHORD_MODES.find((m) => m.id === mode)?.title ?? mode}`} />
      <ChordDecoderGame key={`${level}-${mode}`} level={level} mode={mode} onExit={back} />
    </div>
  );
}

export function ReadingScreen({ level, mode, measures }: { level: number; mode: ReadingMode; measures?: number }) {
  const back = useStore((s) => s.back);
  return (
    <div>
      <Header title="Sight-Reading Arena" subtitle={`Level ${level} · ${READING_MODES.find((m) => m.id === mode)?.title ?? mode}`} />
      <SightReadingGame key={`${level}-${mode}-${measures}`} level={level} mode={mode} measures={measures} onExit={back} />
    </div>
  );
}

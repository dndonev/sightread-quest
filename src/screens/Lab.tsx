import { useState } from 'react';
import { useStore } from '../state/store';
import { Button, Card, Header, Section, Segmented, Slider, Toggle } from '../components/ui';
import { CHORD_MODES, CHORD_LEVELS, type ChordMode } from '../game-engine/chordDecoder';
import { READING_LEVELS } from '../game-engine/sightReading';
import { READING_MODES, type ReadingMode } from '../stages/SightReadingGame';
import { NOTE_MODES, type NoteMode } from '../stages/NoteHunterGame';
import { fromDiatonicIndex, parsePitch, diatonicIndex, pitchToString, displayName } from '../music-theory/pitch';
import type { Clef } from '../notation/staff';

/** Free practice with custom parameters — every level is available here. */
export function PracticeLab() {
  const { settings, navigate } = useStore();
  const guitar = settings.instrument === 'guitar';
  const [clef, setClef] = useState<Clef>(settings.clef === 'bass' ? 'bass' : 'treble');
  const defaults: Record<Clef, [number, number]> = { treble: [diatonicIndex(parsePitch(guitar ? 'E3' : 'A3')), diatonicIndex(parsePitch('C6'))], bass: [diatonicIndex(parsePitch('C2')), diatonicIndex(parsePitch('E4'))] };
  const [lo, setLo] = useState(defaults[clef][0]);
  const [hi, setHi] = useState(defaults[clef][1]);
  const [acc, setAcc] = useState(false);
  const [noteMode, setNoteMode] = useState<NoteMode>('practice');
  const [chordLevel, setChordLevel] = useState(1);
  const [chordMode, setChordMode] = useState<ChordMode>('name');
  const [readLevel, setReadLevel] = useState(1);
  const [readMode, setReadMode] = useState<ReadingMode>('identify');
  const [measures, setMeasures] = useState(4);
  const minD = diatonicIndex(parsePitch(clef === 'treble' ? (guitar ? 'E3' : 'C3') : 'A1'));
  const maxD = diatonicIndex(parsePitch(clef === 'treble' ? 'C7' : 'G4'));
  const name = (d: number) => displayName(fromDiatonicIndex(d), settings.naming, true);

  return (
    <div className="pb-6">
      <Header title="Practice Lab" subtitle="Custom drills — all levels open" />
      <Section title="Note Hunter — custom range">
        <Card className="space-y-3">
          <Segmented
            value={clef}
            onChange={(c) => {
              setClef(c);
              setLo(defaults[c][0]);
              setHi(defaults[c][1]);
            }}
            options={[{ value: 'treble', label: 'Treble' }, { value: 'bass', label: 'Bass' }]}
          />
          <Slider label="Lowest note" value={lo} min={minD} max={hi - 2} onChange={setLo} format={name} />
          <Slider label="Highest note" value={hi} min={lo + 2} max={maxD} onChange={setHi} format={name} />
          <Toggle label="Include sharps & flats" checked={acc} onChange={setAcc} />
          <Segmented value={noteMode} onChange={setNoteMode} options={NOTE_MODES.map((m) => ({ value: m.id, label: m.title }))} />
          <Button
            variant="primary"
            className="w-full"
            onClick={() => navigate('notes', { level: clef === 'bass' ? 8 : 5, mode: noteMode, range: `${pitchToString(fromDiatonicIndex(lo))}-${pitchToString(fromDiatonicIndex(hi))}`, accidentals: acc ? 1 : 0, clef })}
          >
            Start note drill
          </Button>
        </Card>
      </Section>

      <Section title="Chord Decoder">
        <Card className="space-y-3">
          <Slider label="Level" value={chordLevel} min={1} max={10} onChange={setChordLevel} format={(v) => `${v} · ${CHORD_LEVELS[v - 1].title}`} />
          <div className="grid grid-cols-2 gap-1.5">
            {CHORD_MODES.filter((m) => !m.guitarOnly || guitar).map((m) => (
              <button key={m.id} onClick={() => setChordMode(m.id)} className={`min-h-11 rounded-xl border px-2 text-sm font-semibold ${chordMode === m.id ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted'}`}>
                {m.title}
              </button>
            ))}
          </div>
          <Button variant="primary" className="w-full" onClick={() => navigate('chords', { level: chordLevel, mode: chordMode })}>
            Start chord drill
          </Button>
        </Card>
      </Section>

      <Section title="Sight-Reading">
        <Card className="space-y-3">
          <Slider label="Level" value={readLevel} min={1} max={10} onChange={setReadLevel} format={(v) => `${v} · ${READING_LEVELS[v - 1].title}`} />
          <Slider label="Bars per phrase" value={measures} min={2} max={16} step={2} onChange={setMeasures} />
          <div className="grid gap-1.5">
            {READING_MODES.map((m) => (
              <button key={m.id} onClick={() => setReadMode(m.id)} className={`min-h-11 rounded-xl border px-3 text-left text-sm font-semibold ${readMode === m.id ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted'}`}>
                {m.title}
              </button>
            ))}
          </div>
          <Button variant="primary" className="w-full" onClick={() => navigate('reading', { level: readLevel, mode: readMode, measures })}>
            Start sight-reading
          </Button>
        </Card>
      </Section>
    </div>
  );
}

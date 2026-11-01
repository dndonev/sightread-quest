import { useState } from 'react';
import { Guitar, Piano } from 'lucide-react';
import { useStore } from '../state/store';
import { Button, Card, cx } from '../components/ui';
import type { Experience, Instrument } from '../persistence/types';
import type { NoteNaming } from '../music-theory/pitch';

type ClefPref = 'treble' | 'bass' | 'both';

export function Onboarding() {
  const updateSettings = useStore((s) => s.updateSettings);
  const navigate = useStore((s) => s.navigate);
  const current = useStore((s) => s.settings);
  const [step, setStep] = useState(0);
  const [instrument, setInstrument] = useState<Instrument>(current.instrument);
  const [clef, setClef] = useState<ClefPref>(current.clef);
  const [experience, setExperience] = useState<Experience>(current.experience);
  const [goal, setGoal] = useState(current.dailyGoalMin);
  const [naming, setNaming] = useState<NoteNaming>(current.naming);

  const steps = [
    {
      title: 'What do you play?',
      body: (
        <div className="grid grid-cols-2 gap-3">
          {([['guitar', 'Guitar', Guitar], ['piano', 'Piano', Piano]] as const).map(([id, label, Icon]) => (
            <Choice key={id} selected={instrument === id} onClick={() => { setInstrument(id); if (id === 'guitar') setClef('treble'); }}>
              <Icon size={34} className="mb-2" />
              {label}
            </Choice>
          ))}
        </div>
      ),
      note: instrument === 'guitar' ? 'Guitar music is written an octave higher than it sounds — the app keeps written and sounding pitch straight for you.' : undefined,
    },
    {
      title: 'Preferred clef',
      body: (
        <div className="grid gap-2">
          {(['treble', 'bass', 'both'] as ClefPref[]).map((c) => (
            <Choice key={c} selected={clef === c} onClick={() => setClef(c)} row>
              {c === 'treble' ? 'Treble clef' : c === 'bass' ? 'Bass clef' : 'Both (grand staff)'}
            </Choice>
          ))}
        </div>
      ),
      note: instrument === 'guitar' ? 'Guitarists normally read treble clef.' : undefined,
    },
    {
      title: 'Your reading experience',
      body: (
        <div className="grid gap-2">
          {([['beginner', 'Rusty', 'I know theory but read slowly (target < 3 s per note)'], ['intermediate', 'Getting there', 'I can read, just not fluently (target < 1.5 s)'], ['advanced', 'Fluent-ish', 'I want speed and harder material (target < 0.8 s)']] as [Experience, string, string][]).map(([id, t, d]) => (
            <Choice key={id} selected={experience === id} onClick={() => setExperience(id)} row>
              <div>
                <div className="font-semibold">{t}</div>
                <div className="text-sm font-normal text-muted">{d}</div>
              </div>
            </Choice>
          ))}
        </div>
      ),
    },
    {
      title: 'Daily practice goal',
      body: (
        <div className="grid grid-cols-4 gap-2">
          {[5, 10, 15, 20].map((g) => (
            <Choice key={g} selected={goal === g} onClick={() => setGoal(g)}>
              <span className="text-2xl font-black">{g}</span>
              <span className="text-xs text-muted">min</span>
            </Choice>
          ))}
        </div>
      ),
    },
    {
      title: 'Note names',
      body: (
        <div className="grid grid-cols-2 gap-3">
          <Choice selected={naming === 'english'} onClick={() => setNaming('english')}>
            <span className="text-xl font-bold">C D E</span>
            <span className="text-sm text-muted">English</span>
          </Choice>
          <Choice selected={naming === 'solfege'} onClick={() => setNaming('solfege')}>
            <span className="text-xl font-bold">Do Re Mi</span>
            <span className="text-sm text-muted">Solfège</span>
          </Choice>
        </div>
      ),
    },
  ];

  const finish = () => {
    updateSettings({
      onboarded: true,
      instrument,
      clef,
      experience,
      dailyGoalMin: goal,
      naming,
      unlockAll: experience === 'advanced',
      daily: goal === 5 ? { notes: 2, chords: 1, reading: 2 } : goal === 15 ? { notes: 4, chords: 4, reading: 7 } : goal === 20 ? { notes: 5, chords: 5, reading: 10 } : { notes: 3, chords: 3, reading: 4 },
    });
    navigate('home', undefined, true);
  };

  const s = steps[step];
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4" style={{ paddingTop: 'calc(var(--safe-top) + 24px)', paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
      <div className="mb-6">
        <div className="mb-1 bg-gradient-to-r from-accent to-accent-2 bg-clip-text text-sm font-bold uppercase tracking-[0.2em] text-transparent">SightRead Quest</div>
        <div className="flex gap-1.5">
          {steps.map((_, i) => (
            <div key={i} className={cx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-accent' : 'bg-line')} />
          ))}
        </div>
      </div>
      <h1 className="mb-4 text-2xl font-bold">{s.title}</h1>
      <div key={step} className="animate-fade-up">{s.body}</div>
      {s.note && <Card className="mt-4 text-sm text-muted">{s.note}</Card>}
      <div className="flex-1" />
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < steps.length - 1 ? (
          <Button variant="primary" onClick={() => setStep((x) => x + 1)}>
            Next
          </Button>
        ) : (
          <Button variant="primary" onClick={finish}>
            Start training
          </Button>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-faint">You can change all of this later in Settings.</p>
    </div>
  );
}

function Choice({ selected, onClick, children, row }: { selected: boolean; onClick: () => void; children: React.ReactNode; row?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'flex min-h-14 rounded-2xl border p-4 font-semibold transition active:scale-[0.98]',
        row ? 'items-center text-left' : 'flex-col items-center justify-center text-center',
        selected ? 'border-accent bg-accent/10 text-ink ring-1 ring-accent/50' : 'border-line bg-panel text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

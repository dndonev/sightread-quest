import { useEffect } from 'react';
import { BarChart3, Home as HomeIcon, Layers, Settings as SettingsIcon } from 'lucide-react';
import { useStore, type ScreenName } from './state/store';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { LevelSelect, StageSelect } from './screens/Levels';
import { ChordScreen, NoteHunterScreen, ReadingScreen } from './screens/Play';
import { DailyTraining } from './screens/Daily';
import { PracticeLab } from './screens/Lab';
import { Statistics } from './screens/Stats';
import { SettingsScreen } from './screens/Settings';
import type { StageId } from './adaptive-learning/mastery';
import type { NoteMode } from './stages/NoteHunterGame';
import type { ChordMode } from './game-engine/chordDecoder';
import type { ReadingMode } from './stages/SightReadingGame';
import type { Clef } from './notation/staff';
import { cx } from './components/ui';

const NAV: { name: ScreenName; label: string; Icon: typeof HomeIcon }[] = [
  { name: 'home', label: 'Home', Icon: HomeIcon },
  { name: 'stages', label: 'Stages', Icon: Layers },
  { name: 'stats', label: 'Stats', Icon: BarChart3 },
  { name: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export default function App() {
  const { loaded, settings, route, navigate, toast } = useStore();

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.reducedMotion]);

  if (!loaded) {
    return <div className="flex min-h-[100dvh] items-center justify-center text-muted">Loading…</div>;
  }
  if (!settings.onboarded) return <Onboarding />;

  const p = route.params ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(10, v)) : d);
  let screen: React.ReactNode;
  switch (route.name) {
    case 'stages':
      screen = <StageSelect />;
      break;
    case 'levels':
      screen = <LevelSelect key={String(p.stage)} stage={(p.stage as StageId) ?? 'notes'} />;
      break;
    case 'notes':
      screen = <NoteHunterScreen level={num(p.level, 1)} mode={(p.mode as NoteMode) ?? 'practice'} range={p.range as string | undefined} accidentals={p.accidentals === 1} clef={p.clef as Clef | undefined} />;
      break;
    case 'chords':
      screen = <ChordScreen level={num(p.level, 1)} mode={(p.mode as ChordMode) ?? 'name'} />;
      break;
    case 'reading':
      screen = <ReadingScreen level={num(p.level, 1)} mode={(p.mode as ReadingMode) ?? 'identify'} measures={typeof p.measures === 'number' ? p.measures : undefined} />;
      break;
    case 'daily':
      screen = <DailyTraining />;
      break;
    case 'lab':
      screen = <PracticeLab />;
      break;
    case 'stats':
      screen = <Statistics />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    case 'onboarding':
      screen = <Onboarding />;
      break;
    default:
      screen = <Home />;
  }
  const showNav = ['home', 'stages', 'stats', 'settings'].includes(route.name);

  return (
    <div className={cx('mx-auto min-h-[100dvh] w-full max-w-2xl px-4', ['reading', 'chords', 'stats'].includes(route.name) && 'lg:max-w-4xl')} style={{ paddingLeft: 'max(16px, var(--safe-left))', paddingRight: 'max(16px, var(--safe-right))', paddingBottom: showNav ? 'calc(var(--safe-bottom) + 84px)' : 'calc(var(--safe-bottom) + 16px)' }}>
      <main key={route.name} className="animate-fade-up">{screen}</main>
      {showNav && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 backdrop-blur" style={{ paddingBottom: 'var(--safe-bottom)' }} aria-label="Main">
          <div className="mx-auto flex max-w-2xl">
            {NAV.map(({ name, label, Icon }) => (
              <button key={name} onClick={() => navigate(name, undefined, true)} aria-current={route.name === name ? 'page' : undefined} className={cx('flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium', route.name === name ? 'text-accent' : 'text-faint')}>
                <Icon size={22} />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
      {toast && (
        <div className="fixed inset-x-0 z-50 flex justify-center px-4" style={{ bottom: 'calc(var(--safe-bottom) + 96px)' }} role="status">
          <div className="animate-fade-up rounded-2xl border border-line bg-panel-2 px-4 py-2 text-sm shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}

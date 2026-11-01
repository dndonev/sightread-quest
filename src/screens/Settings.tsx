import { useState } from 'react';
import { useStore } from '../state/store';
import { Button, Card, Header, Section, Segmented, Slider, Toggle } from '../components/ui';
import { audio } from '../audio/engine';
import { MicPitchTracker, calibrateNoiseFloor } from '../pitch-detection/mic';
import { median } from '../game-engine/scoring';

export function SettingsScreen() {
  const { settings, updateSettings, resetProgress, showToast } = useStore();
  const [calib, setCalib] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const guitar = settings.instrument === 'guitar';

  const calibrateNoise = async () => {
    await audio.unlock().catch(() => {});
    setCalib('Stay quiet for a moment…');
    const r = await calibrateNoiseFloor(1500);
    if (typeof r === 'string') return setCalib(r === 'denied' ? 'Microphone permission denied.' : 'Microphone unavailable.');
    updateSettings({ mic: { ...settings.mic, noiseFloor: Number(r.toFixed(4)) } });
    setCalib(`Noise floor set to ${r.toFixed(3)}.`);
  };

  const calibrateLatency = async () => {
    await audio.unlock().catch(() => {});
    setCalib('Play one short note on each of the 6 clicks…');
    const onsets: number[] = [];
    const tracker = new MicPitchTracker({ confidence: settings.mic.confidence, noiseFloor: settings.mic.noiseFloor, latencyMs: 0, onNoteOn: (n) => onsets.push(n.time) });
    const err = await tracker.start();
    if (err) return setCalib('Microphone unavailable or denied.');
    const t0 = audio.now() + 1;
    const clicks = Array.from({ length: 6 }, (_, i) => t0 + i * 0.75);
    clicks.forEach((t, i) => audio.metronomeClick(t, i === 0));
    await new Promise((r) => setTimeout(r, 1000 + 6 * 750 + 600));
    tracker.stop();
    const offs = clicks.map((c) => onsets.filter((o) => Math.abs(o - c) < 0.35).sort((a, b) => Math.abs(a - c) - Math.abs(b - c))[0]).filter((o): o is number => o !== undefined).map((o, i) => o - clicks[i]);
    if (offs.length < 3) return setCalib(`Only ${offs.length} notes detected — try again, closer to the microphone.`);
    const latency = Math.round(Math.max(0, Math.min(400, median(offs) * 1000)));
    updateSettings({ mic: { ...settings.mic, latencyMs: latency } });
    setCalib(`Latency compensation set to ${latency} ms (${offs.length}/6 notes).`);
  };

  return (
    <div className="pb-8">
      <Header title="Settings" />
      <Section title="Instrument & reading">
        <Card className="space-y-3">
          <Segmented value={settings.instrument} onChange={(v) => updateSettings({ instrument: v, clef: v === 'guitar' ? 'treble' : settings.clef })} options={[{ value: 'guitar', label: 'Guitar' }, { value: 'piano', label: 'Piano' }]} />
          <Segmented value={settings.clef} onChange={(v) => updateSettings({ clef: v })} options={[{ value: 'treble', label: 'Treble' }, { value: 'bass', label: 'Bass' }, { value: 'both', label: 'Both' }]} />
          <Segmented value={settings.experience} onChange={(v) => updateSettings({ experience: v })} options={[{ value: 'beginner', label: 'Rusty' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }]} />
          <Segmented value={settings.naming} onChange={(v) => updateSettings({ naming: v })} options={[{ value: 'english', label: 'C D E' }, { value: 'solfege', label: 'Do Re Mi' }]} />
          <Toggle label="Octave recognition" hint="Name the octave as well as the letter in Note Hunter" checked={settings.octaveRecognition} onChange={(v) => updateSettings({ octaveRecognition: v })} />
          {guitar && (
            <>
              <div>
                <div className="mb-1 font-medium">Octave numbers for guitar</div>
                <Segmented value={settings.octaveLabels} onChange={(v) => updateSettings({ octaveLabels: v })} options={[{ value: 'written', label: 'Written pitch' }, { value: 'sounding', label: 'Concert (sounding)' }]} />
                <p className="mt-1 text-xs text-muted">Guitar sounds an octave below the written note: the open high E string is written E5 and sounds E4. Audio always plays sounding pitch.</p>
              </div>
              <Toggle label="Show tablature" hint="Pairs TAB with the staff in Sight-Reading. Hide it to train staff reading." checked={settings.showTab} onChange={(v) => updateSettings({ showTab: v })} />
            </>
          )}
        </Card>
      </Section>

      <Section title="Progression">
        <Card className="space-y-3">
          <Slider label="Mastery threshold" value={Math.round(settings.masteryThreshold * 100)} min={70} max={100} onChange={(v) => updateSettings({ masteryThreshold: v / 100 })} format={(v) => `${v}%`} />
          <Toggle label="Unlock all levels" hint="Skip the mastery gates (progress is still tracked)" checked={settings.unlockAll} onChange={(v) => updateSettings({ unlockAll: v })} />
          <Slider label="Daily goal" value={settings.dailyGoalMin} min={5} max={60} step={5} onChange={(v) => updateSettings({ dailyGoalMin: v })} format={(v) => `${v} min`} />
        </Card>
      </Section>

      <Section title="Sound & motion">
        <Card className="space-y-2">
          <Toggle label="Sound effects & note playback" checked={settings.sfx} onChange={(v) => updateSettings({ sfx: v })} />
          <Toggle label="Metronome during sight-reading" hint="The count-in always clicks" checked={settings.metronome} onChange={(v) => updateSettings({ metronome: v })} />
          <Slider label="Volume" value={Math.round(settings.volume * 100)} min={0} max={100} onChange={(v) => updateSettings({ volume: v / 100 })} format={(v) => `${v}%`} />
          <Button className="w-full" onClick={async () => { await audio.unlock(); audio.setVolume(settings.volume); audio.playChord([52, 59, 64, 68, 71, 76]); }}>Test sound</Button>
          <div>
            <div className="mb-1 font-medium">Reduced motion</div>
            <Segmented value={settings.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
          </div>
        </Card>
      </Section>

      <Section title="Microphone (Real Instrument mode)">
        <Card className="space-y-3">
          <p className="text-sm text-muted">Monophonic pitch detection (YIN). Works best with single notes, a quiet room and the instrument close to the microphone. Chords are not detected.</p>
          <Slider label="Confidence threshold" value={Math.round(settings.mic.confidence * 100)} min={50} max={98} onChange={(v) => updateSettings({ mic: { ...settings.mic, confidence: v / 100 } })} format={(v) => `${v}%`} />
          <Slider label="Noise floor" value={Math.round(settings.mic.noiseFloor * 1000)} min={2} max={80} onChange={(v) => updateSettings({ mic: { ...settings.mic, noiseFloor: v / 1000 } })} format={(v) => (v / 1000).toFixed(3)} />
          <Slider label="Latency compensation" value={settings.mic.latencyMs} min={0} max={400} step={5} onChange={(v) => updateSettings({ mic: { ...settings.mic, latencyMs: v } })} format={(v) => `${v} ms`} />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={calibrateNoise}>Calibrate noise</Button>
            <Button onClick={calibrateLatency}>Calibrate latency</Button>
          </div>
          {calib && <p className="text-sm text-accent-2" aria-live="polite">{calib}</p>}
        </Card>
      </Section>

      <Section title="Data">
        <Card className="space-y-2">
          <p className="text-sm text-muted">Progress is stored on this device (IndexedDB) and works offline.</p>
          {!confirmReset ? (
            <Button variant="danger" className="w-full" onClick={() => setConfirmReset(true)}>Reset progress…</Button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button variant="danger" onClick={async () => { await resetProgress(); setConfirmReset(false); showToast('Progress reset'); }}>Erase everything</Button>
            </div>
          )}
          <Button variant="ghost" className="w-full" onClick={() => updateSettings({ onboarded: false })}>Run onboarding again</Button>
        </Card>
      </Section>
      <p className="text-center text-xs text-faint">SightRead Quest v1.0 · notation by VexFlow · audio by Tone.js</p>
    </div>
  );
}

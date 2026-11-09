/**
 * End-to-end smoke test in real Chromium (Playwright).
 * Usage: build + start the server (npm run build && npm start), then: npm run test:e2e
 * Verifies: app loads, Generate Music produces a multi-track arrangement, playback advances,
 * an offline render of the song contains audible audio, undo works, project persists across reload.
 */
import { createRequire } from 'node:module';
const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));
const URL = process.env.AIMS_URL || 'http://localhost:8787';
const SHOTS = process.env.AIMS_SHOTS;
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1500, height: 920 }, deviceScaleFactor: SHOTS ? 2 : 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.waitForSelector('text=Describe a song', { timeout: 15000 });
console.log('✓ beginner screen loaded');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-beginner.png` });
await page.fill('textarea.prompt-box', 'Create a two-minute heroic orchestral soundtrack with emotional strings, bold brass, cinematic percussion, and a massive final climax.');
await page.click('button:has-text("Generate Music")');
await page.waitForFunction(() => window.aims.useStudio.getState().project.tracks.length > 3, null, { timeout: 30000 });
const info = await page.evaluate(() => { const p = window.aims.useStudio.getState().project; return { tracks: p.tracks.map((t) => t.name), sections: p.sections.map((s) => s.name), notes: p.tracks.reduce((a, t) => a + t.clips.reduce((b, c) => b + c.notes.length, 0), 0), bpm: p.bpm }; });
console.log(`✓ generated: ${info.tracks.length} tracks, ${info.sections.length} sections, ${info.notes} notes @ ${info.bpm} BPM`);
console.log('  tracks:', info.tracks.join(', '));
// play
await page.click('button:has-text("Play")');
await page.waitForTimeout(2500);
const pos = await page.evaluate(() => ({ beat: window.aims.engine.positionBeat(), playing: window.aims.engine.playing, ctx: window.aims.engine.cpuInfo() }));
if (!pos.playing || pos.beat < 1) fail(`playback did not advance (${JSON.stringify(pos)})`); else console.log(`✓ playback running: beat ${pos.beat.toFixed(2)}, ${pos.ctx.voices} voices, ${pos.ctx.sampleRate} Hz`);
const level = await page.evaluate(async () => { let m = 0; for (let i = 0; i < 20; i++) { const r = window.aims.engine.readMaster(); m = Math.max(m, r[0], r[1]); await new Promise((r) => setTimeout(r, 50)); } return m; });
if (level < 0.001) fail(`master meter silent during playback (${level})`); else console.log(`✓ live master output peak ${(20 * Math.log10(level)).toFixed(1)} dBFS`);
await page.click('button:has-text("Pause")');
// studio view
await page.click('button:has-text("Edit in studio")');
await page.waitForSelector('.timeline');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-studio.png` });
console.log('✓ studio view');
// offline render (same path as WAV export) of the first 16 beats
const r = await page.evaluate(async () => {
  const { renderProject, analyze, useStudio, engine } = window.aims;
  const buf = await renderProject(useStudio.getState().project, engine.assets, { sampleRate: 48000, startBeat: 0, endBeat: 32 });
  const a = analyze(buf);
  return { dur: buf.duration, peak: a.peakDb, lufs: a.lufs };
});
if (r.peak < -40) fail(`offline render silent ${JSON.stringify(r)}`); else console.log(`✓ offline render ${r.dur.toFixed(1)}s peak ${r.peak.toFixed(1)} dBFS, ${r.lufs.toFixed(1)} LUFS`);
// AI action + undo
const before = await page.evaluate(() => window.aims.useStudio.getState().project.tracks.length);
await page.click('button:has-text("More cinematic")');
const after = await page.evaluate(() => window.aims.useStudio.getState().project.tracks.length);
await page.keyboard.press('Control+z');
const undone = await page.evaluate(() => window.aims.useStudio.getState().project.tracks.length);
if (!(after >= before && undone === before)) fail(`AI action/undo mismatch ${before} ${after} ${undone}`); else console.log(`✓ AI action (${before}→${after} tracks) and undo (${undone})`);
// local assistant
await page.evaluate(() => window.aims.actions.runInstruction('The bass sounds too weak', false));
const chat = await page.evaluate(() => window.aims.useStudio.getState().chat.slice(-1)[0]);
if (!chat?.applied?.length) fail('local assistant applied nothing: ' + JSON.stringify(chat)); else console.log('✓ local assistant:', chat.applied.join('; '));
// open piano roll on first melodic clip
await page.evaluate(() => { const s = window.aims.useStudio.getState(); const t = s.project.tracks.find((t) => t.role === 'melody'); s.set({ editClipId: t.clips[0].id, bottomTab: 'editor' }); });
await page.waitForTimeout(300);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-pianoroll.png` });
for (const tab of ['Mixer', 'Instrument & FX', 'Automation', 'Vocals & Lyrics', 'Master & Analysis']) {
  await page.click(`button.tab:has-text("${tab}")`, { timeout: 5000 });
  await page.waitForTimeout(250);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tab-${tab.split(' ')[0].toLowerCase()}.png` });
}
console.log('✓ all bottom panels render');
// drum step sequencer
await page.evaluate(() => { const s = window.aims.useStudio.getState(); const t = s.project.tracks.find((t) => t.type === 'drums'); s.set({ editClipId: t.clips.find((c) => c.notes.length).id }); });
await page.click('button.tab:has-text("Piano Roll")');
await page.waitForTimeout(250);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-drums.png` });
if (!(await page.$('text=step sequencer'))) fail('drum editor did not render'); else console.log('✓ drum step sequencer renders');
// real export through the Export dialog: capture the downloaded WAV and check it
await page.evaluate(() => window.aims.useStudio.getState().set({ selection: { from: 0, to: 24 } }));
await page.click('button:has-text("Export")');
await page.selectOption('label:has-text("Range") select', 'selection');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('button:has-text("Render & download")')]);
const wavPath = await dl.path();
const { readFileSync } = await import('node:fs');
const buf = readFileSync(wavPath);
const ch = buf.readUInt16LE(22), sr = buf.readUInt32LE(24), bits = buf.readUInt16LE(34);
let peak = 0;
for (let o = 44; o + 3 <= buf.length; o += 3 * 50) { let x = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16); if (x & 0x800000) x -= 0x1000000; peak = Math.max(peak, Math.abs(x) / 8388608); }
const secs = (buf.length - 44) / (ch * sr * bits / 8);
if (buf.toString('ascii', 0, 4) !== 'RIFF' || peak < 0.05 || secs < 5) fail(`exported WAV invalid: ${ch}ch ${sr}Hz ${bits}bit ${secs.toFixed(1)}s peak ${peak}`);
else console.log(`✓ exported ${dl.suggestedFilename()}: ${ch}ch ${sr} Hz ${bits}-bit, ${secs.toFixed(1)} s, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
await page.selectOption('label:has-text("Format") select', 'mp3');
const [mp3] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('button:has-text("Render & download")')]);
const mp3buf = readFileSync(await mp3.path());
const frameSync = mp3buf[0] === 0xff && (mp3buf[1] & 0xe0) === 0xe0;
if (!frameSync || mp3buf.length < 50000) fail(`MP3 export invalid (${mp3buf.length} bytes)`); else console.log(`✓ exported ${mp3.suggestedFilename()} (${(mp3buf.length / 1024).toFixed(0)} KB, valid MPEG frames)`);
const [mid] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("MIDI (.mid)")')]);
const mbuf = readFileSync(await mid.path());
if (mbuf.toString('ascii', 0, 4) !== 'MThd') fail('MIDI export invalid'); else console.log(`✓ exported ${mid.suggestedFilename()} (${mbuf.length} bytes)`);
await page.keyboard.press('Escape');
// microphone recording (Chromium fake device produces a test tone)
const rec = await page.evaluate(async () => {
  const { actions, useStudio, engine } = window.aims;
  useStudio.getState().commit('count-in off', (p) => ({ ...p, metronome: { ...p.metronome, countInBars: 0 } }));
  useStudio.getState().set({ cursorBeat: 4 });
  await actions.toggleRecord();
  await new Promise((r) => setTimeout(r, 2500));
  await actions.toggleRecord();
  const p = useStudio.getState().project;
  const t = p.tracks.find((x) => x.type === 'audio' && x.clips.length);
  const c = t?.clips[0];
  const b = c?.audio && engine.assets.get(c.audio.assetId);
  let peak = 0;
  if (b) for (const v of b.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
  return { ok: !!b, start: c?.start, secs: b?.duration, peak };
});
if (!rec.ok || rec.secs < 1 || rec.peak < 0.001) fail('recording failed ' + JSON.stringify(rec)); else console.log(`✓ recorded ${rec.secs.toFixed(2)} s from the (fake) microphone at beat ${rec.start.toFixed(2)}, peak ${(20 * Math.log10(rec.peak)).toFixed(1)} dBFS`);
// persistence
const id = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 1600)); return window.aims.useStudio.getState().project.id; });
await page.reload();
await page.waitForSelector('.timeline', { timeout: 15000 });
const id2 = await page.evaluate(() => window.aims.useStudio.getState().project.id);
const n2 = await page.evaluate(() => window.aims.useStudio.getState().project.tracks.length);
if (id !== id2 || n2 < 3) fail(`project not restored after reload (${id} vs ${id2}, ${n2} tracks)`); else console.log('✓ project restored after reload');
if (errors.length) fail('page errors:\n' + errors.join('\n')); else console.log('✓ no page errors');
await browser.close();

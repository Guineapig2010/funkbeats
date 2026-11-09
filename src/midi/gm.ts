/** Map General MIDI program numbers to the closest built-in (synthesized) preset. */
export function GM_PROGRAM_PRESETS(program: number): string {
  const p = program;
  if (p <= 3) return 'synth-piano';
  if (p <= 5) return 'epiano';
  if (p === 6 || p === 7) return 'clav';
  if (p <= 15) return p >= 8 && p <= 10 ? 'celesta' : 'marimba';
  if (p <= 23) return 'organ-full';
  if (p <= 25) return 'nylon-guitar';
  if (p <= 28) return 'steel-guitar';
  if (p <= 31) return 'dist-guitar';
  if (p <= 39) return p >= 38 ? 'synth-bass' : 'pick-bass';
  if (p === 40) return 'violins';
  if (p === 42 || p === 43) return 'cellos';
  if (p === 45) return 'pizzicato';
  if (p === 46) return 'harp';
  if (p === 47) return 'timpani';
  if (p <= 51) return 'string-ensemble';
  if (p <= 54) return 'synth-choir';
  if (p === 56) return 'trumpet';
  if (p === 57) return 'trombone';
  if (p === 60) return 'french-horns';
  if (p <= 63) return 'brass-section';
  if (p <= 67) return 'sax';
  if (p <= 71) return 'clarinet';
  if (p <= 79) return 'flute';
  if (p <= 87) return p === 80 ? 'square-lead' : 'saw-lead';
  if (p <= 95) return 'warm-pad';
  if (p <= 103) return 'glass-pad';
  if (p <= 111) return 'pluck';
  if (p <= 119) return 'marimba';
  return 'noise-riser';
}

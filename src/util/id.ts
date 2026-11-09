let counter = 0;
/** Short unique ids, stable enough for project-local identity. */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(4, '0')}${rand}`;
}

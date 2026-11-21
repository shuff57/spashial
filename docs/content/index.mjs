// The docs, in reading order. Each file is one list of pages; a page's `id` is its permanent address
// (#/id), so never rename one. The sidebar groups pages by their `group`, in the order they appear.
import start from './01-start.mjs';
import physics from './02-physics.mjs';
import interaction from './03-interaction.mjs';
import guides from './04-guides.mjs';
import media from './05-media.mjs';
import sound from './06-sound.mjs';
import saving from './07-saving.mjs';
import online from './08-online.mjs';

export { REFERENCE, GLOBALS, GLOBAL_VALUES } from './reference-data.mjs';

// Reading order: Start, Objects, Physics, Interaction, World, Guides, Reference.
const all = [...start, ...physics, ...media, ...interaction, ...sound, ...saving, ...online, ...guides];
const ORDER = ['Start', 'Objects', 'Physics', 'Interaction', 'World', 'Guides', 'Reference'];
export const pages = ORDER.flatMap((g) => all.filter((p) => p.group === g));
export const groups = ORDER;

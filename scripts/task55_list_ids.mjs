import { createSources } from '../src/source/index.js';
const sources = createSources(null);
console.log('total:', sources.length);
console.log(sources.map(s => s.id).join(' '));

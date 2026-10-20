// Side-effect entry: `FASTFORWARD=1 node --import fastforward-register app.js` (spec §5, §11).
// Inactive unless FASTFORWARD is exactly "1".
import { installRedirect } from './redirect.js';

export { FastforwardLiveCallError } from './redirect.js';

if (process.env.FASTFORWARD === '1') installRedirect(process.env.FF_TWIN_URL ?? 'http://127.0.0.1:4010');

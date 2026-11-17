// Party Presents: the app's entry point. The shell (routing, rendering, the tap
// handlers) is js/core.js; each screen is a module in js/views/ that adds
// itself to core's routes and actions when it's loaded.
import { start } from './core.js?v=9';
import './views/signin.js?v=9';
import './views/home.js?v=9';
import './views/scan.js?v=9';
import './views/event.js?v=9';
import './views/edit.js?v=9';
import './views/calendar.js?v=9';
import './views/ideas.js?v=9';
import './views/cupboard.js?v=9';
import './views/friends.js?v=9';
import './views/wishes.js?v=9';
import './views/settings.js?v=9';

start();

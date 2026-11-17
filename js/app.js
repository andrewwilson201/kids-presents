// Party Presents: the app's entry point. The shell (routing, rendering, the tap
// handlers) is js/core.js; each screen is a module in js/views/ that adds
// itself to core's routes and actions when it's loaded.
import { start } from './core.js?v=10';
import './views/signin.js?v=10';
import './views/home.js?v=10';
import './views/scan.js?v=10';
import './views/event.js?v=10';
import './views/edit.js?v=10';
import './views/calendar.js?v=10';
import './views/ideas.js?v=10';
import './views/cupboard.js?v=10';
import './views/friends.js?v=10';
import './views/wishes.js?v=10';
import './views/settings.js?v=10';

start();

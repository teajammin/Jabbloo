/**
 * Jabbloo entry point.
 *
 * Screens are DOM; the battle stage will be the Pixi canvas inside one of
 * them. The engine sandbox lives separately at /sandbox.html.
 */

import './styles.css';
import { mount, setHome } from './ui/screens';
import { launchScreen } from './ui/launch';
import { joinRoomScreen } from './ui/joinRoom';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app missing');

setHome(launchScreen);
const go = mount(root);

// A shared link (/?room=ABCD) drops straight into joining, code prefilled.
go(new URLSearchParams(location.search).has('room') ? joinRoomScreen : launchScreen);

/**
 * Bundle entry for the screen smoke tests.
 *
 * The screens are browser modules; this gathers them into one bundle esbuild
 * can hand to Node, so the tests import a single file rather than reaching
 * into src/ through a chain of relative paths.
 */
export { mount, setHome, goHome } from '../src/ui/screens';
export { launchScreen } from '../src/ui/launch';
export { lobbyScreen } from '../src/ui/lobby';
export { phoneLink } from '../src/ui/phoneLink';
export { createRoomScreen } from '../src/ui/createRoom';
export { joinRoomScreen } from '../src/ui/joinRoom';
export { drawScreen } from '../src/ui/drawScreen';
export { creationScreen } from '../src/ui/creation';
export { battlegroundScreen } from '../src/ui/battleground';
export { battleScreen } from '../src/ui/battle';
export { moveScreen } from '../src/ui/move';
export { resultsScreen } from '../src/ui/results';
export { mountOptions } from '../src/ui/options';
export { teamBoard } from '../src/ui/teams';
export { loadSettings } from '../src/settings';
export { DrawCanvas } from '../src/draw/DrawCanvas';
export { deviceId, randomId } from '../src/net/room';

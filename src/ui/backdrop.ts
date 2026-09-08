import { getSettings, onSettingsChange } from '../settings';

/**
 * The drifting-colour background behind every menu screen.
 *
 * Four soft blobs of the game's palette, each wandering its own course at its
 * own tempo, so the pattern never quite repeats. No photograph and no video:
 * it is four divs and a blur, which costs nothing to download and scales to
 * any screen without a second asset.
 *
 * Driven by the Web Animations API rather than CSS keyframes so that one place
 * decides whether it runs — the options menu's reduced-motion setting stops it,
 * as does the device asking for less motion of its own accord.
 *
 * The battle stage is deliberately excluded: a background that draws the eye
 * during a fight competes with the fight.
 */

/*
 * Blue, purple, orange, green — with the purple deepened.
 *
 * The other three are as they were; only the purple has changed, from a light
 * magenta to something darker and less pink. It anchors the other three, which
 * a pastel of the same hue could not: everything drifting at the same weight
 * reads as a wash rather than as colours moving.
 */
const COLOURS = ['#9a4fb0', '#f2a25c', '#7db4ee', '#9ad9a0'];

/** Slow enough to be scenery. Anything faster asks to be watched. */
const CYCLE_SECONDS = 26;

export function mountBackdrop(): () => void {
  const root = document.createElement('div');
  root.className = 'backdrop';
  root.setAttribute('aria-hidden', 'true');

  const animations: Animation[] = [];

  COLOURS.forEach((colour, i) => {
    const blob = document.createElement('div');
    blob.className = 'backdrop-blob';
    blob.style.background = colour;
    blob.style.width = `${40 + i * 6}%`;
    // The purple is the darkest of the four, so a little less of it goes as
    // far as more of the others.
    if (i === 0) blob.style.opacity = '0.5';
    root.appendChild(blob);

    const path = [
      [-14 + i * 24, -10 + i * 15], [56 - i * 10, 22 + i * 9],
      [16 + i * 13, 56 - i * 7], [68 - i * 15, -8 + i * 11],
    ];
    animations.push(blob.animate(
      path.map(([x, y]) => ({ transform: `translate(${x}%, ${y}%)` })),
      {
        duration: (CYCLE_SECONDS + i * 5) * 1000,
        iterations: Infinity,
        direction: 'alternate',
        easing: 'ease-in-out',
      },
    ));
  });

  document.body.prepend(root);

  /** Still colours are still pleasant; only the drifting has to stop. */
  function apply(): void {
    const still = getSettings().reduceMotion;
    for (const animation of animations) {
      if (still) animation.pause();
      else animation.play();
    }
  }

  apply();
  const stopWatching = onSettingsChange(apply);

  return () => {
    stopWatching();
    for (const animation of animations) animation.cancel();
    root.remove();
  };
}

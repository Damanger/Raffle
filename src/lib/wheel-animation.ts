/** The animation is cosmetic; the server chooses and saves the ticket independently. */
export function planWheelAnimation(currentRotation: number, targetRotation: number, randomWord: () => number = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]) {
  const turns = 3 + (randomWord() >>> 0) % 8;
  const normalize = (angle: number) => (angle % 360 + 360) % 360;
  const alignment = normalize(normalize(targetRotation) - normalize(currentRotation));
  return { turns, rotation: currentRotation + turns * 360 + alignment, duration: 3 + turns * 0.5 };
}

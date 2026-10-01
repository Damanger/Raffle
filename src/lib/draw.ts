import type { RafflePublic } from './model';

export interface DrawProgress {
  totalSpins: number;
  initialCount: number;
  startedAt: number;
  round: number;
  lastNumber: number;
  history: string;
  winnerCount?: number;
}

export function drawnNumbers(raffle: RafflePublic): number[] {
  return raffle.draw ? raffle.draw.history.split(',').map(Number) : [];
}

export function eliminatedNumbers(raffle: RafflePublic): number[] {
  const history = drawnNumbers(raffle);
  return raffle.draw ? history.slice(0, eliminationCount(raffle)) : [];
}

export function drawWinnerCount(raffle: RafflePublic): number { return raffle.draw?.winnerCount ?? 1; }
export function eliminationCount(raffle: RafflePublic): number { return Math.max(0, (raffle.draw?.totalSpins || 1) - drawWinnerCount(raffle)); }
export function winnerNumbers(raffle: RafflePublic): number[] {
  return raffle.draw ? drawnNumbers(raffle).slice(eliminationCount(raffle)) : raffle.result ? [raffle.result.number] : [];
}
export function nextDrawKind(raffle: RafflePublic): 'winner' | 'elimination' {
  return (raffle.draw?.round || 0) >= eliminationCount(raffle) ? 'winner' : 'elimination';
}

export function eligibleNumbers(raffle: RafflePublic): number[] {
  // At completion retain the last spin's pool so the pointer still shows its winner.
  const drawn = drawnNumbers(raffle);
  const excluded = new Set(raffle.result ? drawn.slice(0, -1) : drawn);
  return Object.keys(raffle.sold || {}).map(Number).filter(n =>
    Number.isInteger(n) && n >= 1 && n <= raffle.ticketCount && raffle.sold[String(n)] === n && !excluded.has(n),
  ).sort((a, b) => a - b);
}

export function wheelSegments(numbers: number[]) {
  const step = 360 / numbers.length;
  const point = (angle: number, radius: number) => {
    const radians = angle * Math.PI / 180;
    return { x: 160 + radius * Math.sin(radians), y: 160 - radius * Math.cos(radians) };
  };
  return numbers.map((number, index) => {
    const start = index * step;
    const end = start + step;
    const angle = start + step / 2;
    const a = point(start, 154), b = point(end, 154), label = point(angle, 128);
    return {
      number, angle, x: label.x, y: label.y,
      path: `M160 160 L${a.x} ${a.y} A154 154 0 ${step > 180 ? 1 : 0} 1 ${b.x} ${b.y} Z`,
      rotation: (360 - angle) % 360,
    };
  });
}

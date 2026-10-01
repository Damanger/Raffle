import test from 'node:test';
import assert from 'node:assert/strict';
import { drawRaffle, sellTicket, type Raffle } from '../src/lib/model.ts';
import { drawnNumbers, eliminatedNumbers, eligibleNumbers, wheelSegments, winnerNumbers, drawWinnerCount, nextDrawKind } from '../src/lib/draw.ts';
import { planWheelAnimation } from '../src/lib/wheel-animation.ts';

const raffle = (count = 4): Raffle => ({ public: {
  title: 'Rifa de prueba', ownerId: 'ana', organizer: 'Ana', createdAt: 1, ticketCount: count + 1,
  prizes: [], sold: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, i + 1])),
}, entries: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, { buyer: `Persona ${i + 1}`, contact: '', soldAt: 1 }])) });

test('each button press eliminates exactly one number and only the last spin chooses the winner', () => {
  const r = raffle();
  const originalEntries = structuredClone(r.entries);
  for (let round = 1; round <= 4; round++) {
    const before = eligibleNumbers(r.public);
    drawRaffle(r, { spins: 4, expectedRound: round - 1 });
    assert.equal(r.public.draw?.round, round);
    assert.ok(before.includes(r.public.draw!.lastNumber));
    assert.equal(new Set(drawnNumbers(r.public)).size, round);
    assert.equal(eliminatedNumbers(r.public).length, Math.min(round, 3));
    if (round < 4) {
      assert.equal(r.public.result, undefined);
      assert.equal(eligibleNumbers(r.public).length, 4 - round);
      assert.ok(!eligibleNumbers(r.public).includes(r.public.draw!.lastNumber));
    }
  }
  assert.equal(r.public.result?.number, r.public.draw?.lastNumber);
  assert.equal(r.public.result?.eligibleCount, 4);
  assert.equal(eligibleNumbers(r.public).length, 1);
  assert.deepEqual(r.entries, originalEntries);
  assert.equal(Object.keys(r.public.sold).length, 4);
  assert.throws(() => drawRaffle(r), /ya está registrado/);
});

test('progress survives reload; stale rounds, changing the plan and new sales are rejected', () => {
  const r = raffle(); drawRaffle(r, { spins: 3, expectedRound: 0 });
  const saved = JSON.stringify(r);
  assert.throws(() => drawRaffle(r, { expectedRound: 0 }), /otra ventana/);
  assert.throws(() => drawRaffle(r, { spins: 2, expectedRound: 1 }), /cantidad de giros/);
  assert.throws(() => sellTicket(r, { number: 5, buyer: 'Venta tardía' }), /ventas están cerradas/);
  assert.equal(JSON.stringify(r), saved);
  const restored: Raffle = JSON.parse(saved);
  drawRaffle(restored, { expectedRound: 1 });
  assert.equal(restored.public.draw?.round, 2);
  assert.equal(drawnNumbers(restored.public).length, 2);
  assert.equal(new Set(drawnNumbers(restored.public)).size, 2);
  drawRaffle(restored, { expectedRound: 2 });
  assert.ok(restored.public.result);
  assert.ok(!eliminatedNumbers(restored.public).includes(restored.public.result!.number));
});

test('zero eliminations selects a winner immediately and invalid plans change nothing', () => {
  const one = raffle(1); drawRaffle(one, { spins: 1, expectedRound: 0 });
  assert.equal(one.public.result?.number, 1); assert.deepEqual(eliminatedNumbers(one.public), []);
  for (const spins of [0, -1, 5, 1.5, '2', null]) {
    const r = raffle(); const saved = JSON.stringify(r);
    assert.throws(() => drawRaffle(r, { spins }));
    assert.equal(JSON.stringify(r), saved);
  }
  const empty = raffle(0); assert.throws(() => drawRaffle(empty), /al menos un boleto/);
});

test('the wheel contains every participant exactly once and the pointer aligns with the selected sector', () => {
  for (const count of [1, 8, 319, 720, 5000]) {
    const numbers = Array.from({ length: count }, (_, i) => i + 1);
    const segments = wheelSegments(numbers);
    assert.deepEqual(segments.map(segment => segment.number), numbers);
    assert.equal(new Set(segments.map(segment => segment.number)).size, count);
    for (const segment of segments) assert.ok(Math.abs((segment.angle + segment.rotation) % 360) < 0.000001);
  }
});

test('multiple winners follow eliminations, persist one per spin and never repeat any selected ticket', () => {
  const r = raffle(6);
  const entries = structuredClone(r.entries);
  for (let round=0;round<5;round++) {
    const pool = eligibleNumbers(r.public);
    drawRaffle(r,{spins:5,winnerCount:3,expectedRound:round});
    assert.ok(pool.includes(r.public.draw!.lastNumber));
    assert.equal(eliminatedNumbers(r.public).length,Math.min(round+1,2));
    assert.equal(winnerNumbers(r.public).length,Math.max(0,round-1));
    assert.equal(new Set(drawnNumbers(r.public)).size,round+1);
    if (round<4) {
      assert.equal(r.public.result,undefined);
      assert.ok(!eligibleNumbers(r.public).includes(r.public.draw!.lastNumber));
    }
    if (round===1) assert.equal(nextDrawKind(r.public),'winner');
  }
  assert.equal(drawWinnerCount(r.public),3);
  assert.ok(r.public.result);
  assert.equal(r.public.result!.number,winnerNumbers(r.public).at(-1));
  assert.ok(!winnerNumbers(r.public).some(number=>eliminatedNumbers(r.public).includes(number)));
  assert.deepEqual(r.entries,entries);
});

test('every sold ticket can win with zero eliminations; invalid winner plans do not modify data', () => {
  const r=raffle(3);
  for(let round=0;round<3;round++) drawRaffle(r,{winnerCount:3,expectedRound:round});
  assert.deepEqual([...winnerNumbers(r.public)].sort(),[1,2,3]);
  assert.deepEqual(eliminatedNumbers(r.public),[]);
  for (const winnerCount of [0,-1,5,1.5,'2',null]) {
    const invalid=raffle(),before=JSON.stringify(invalid);
    assert.throws(()=>drawRaffle(invalid,{winnerCount}));
    assert.equal(JSON.stringify(invalid),before);
  }
  const invalid=raffle();assert.throws(()=>drawRaffle(invalid,{spins:2,winnerCount:3}));assert.equal(invalid.public.draw,undefined);
});

test('winner count survives reload, cannot change mid-draw, and legacy draws still choose one winner', () => {
  const r=raffle();drawRaffle(r,{spins:3,winnerCount:2,expectedRound:0});
  const before=JSON.stringify(r);
  assert.throws(()=>drawRaffle(r,{winnerCount:1,expectedRound:1}),/cantidad de ganadores/);
  assert.equal(JSON.stringify(r),before);
  const restored=JSON.parse(before) as Raffle;
  drawRaffle(restored,{expectedRound:1});assert.equal(winnerNumbers(restored.public).length,1);
  drawRaffle(restored,{expectedRound:2});assert.equal(winnerNumbers(restored.public).length,2);assert.ok(restored.public.result);
  const legacy=raffle();drawRaffle(legacy,{spins:2});delete legacy.public.draw!.winnerCount;
  assert.equal(drawWinnerCount(legacy.public),1);assert.equal(winnerNumbers(legacy.public).length,0);
  drawRaffle(legacy,{expectedRound:1});assert.equal(winnerNumbers(legacy.public).length,1);
  const oldResult=raffle();oldResult.public.result={number:2,drawnAt:1,eligibleCount:4};assert.deepEqual(winnerNumbers(oldResult.public),[2]);
});

test('animation chooses 3 to 10 complete turns and always aligns with the server-selected sector', () => {
  for (const current of [0,37,359,720,-45,3600.25]) {
    for (const segment of wheelSegments([1,7,42,103])) {
      for (let word=0;word<8;word++) {
        const plan=planWheelAnimation(current,segment.rotation,()=>word);
        const displacement=plan.rotation-current;
        assert.equal(plan.turns,3+word);
        assert.equal(Math.floor(displacement/360),plan.turns);
        assert.ok(displacement>=3*360 && displacement<11*360);
        assert.ok(Math.abs((plan.rotation+segment.angle)%360)<0.000001);
        assert.ok(plan.duration>=4.5 && plan.duration<=8);
      }
    }
  }
  for (let draw=0;draw<32;draw++) {
    const plan=planWheelAnimation(0,125);
    assert.ok(Number.isInteger(plan.turns) && plan.turns>=3 && plan.turns<=10);
  }
});

test('only names of drawn winners become public; eliminated buyers, contacts and sellers stay private', () => {
  const r=raffle(4);
  for(const entry of Object.values(r.entries!)){entry.contact='Contacto confidencial';entry.seller='Vendedor privado';}
  drawRaffle(r,{spins:3,winnerCount:2,expectedRound:0});
  const eliminated=r.public.draw!.lastNumber;
  assert.equal(r.public.winnerNames,undefined);
  for(let round=1;round<3;round++) {
    drawRaffle(r,{expectedRound:round,winnerNames:{1:'Nombre falsificado'}});
    const winners=winnerNumbers(r.public);
    assert.deepEqual(Object.keys(r.public.winnerNames!).sort(),winners.map(String).sort());
    for(const number of winners) assert.equal(r.public.winnerNames![number],r.entries![number].buyer);
    assert.equal(r.public.winnerNames![eliminated],undefined);
    assert.doesNotMatch(JSON.stringify(r.public),/Contacto confidencial|Vendedor privado|Nombre falsificado/);
  }
  const restored=JSON.parse(JSON.stringify(r)) as Raffle;
  assert.deepEqual(restored.public.winnerNames,r.public.winnerNames);
});

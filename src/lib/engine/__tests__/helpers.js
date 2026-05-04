import { createInitialRoom, newSeat } from '../createGame.js';

export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function makeRoom(playerCount = 2, opts = {}) {
  const room = createInitialRoom({
    code: 'TEST',
    hostPlayerToken: 'T0',
    rngSeed: 1
  });
  for (let i = 0; i < playerCount; i++) {
    room.seats.push(newSeat({
      seat: i,
      playerToken: 'T' + i,
      name: 'P' + i,
      tokenPiece: ['topHat', 'iron', 'boot', 'dog', 'racecar', 'thimble', 'cannon', 'battleship'][i]
    }));
  }
  room.phase = 'playing';
  if (opts.cash) {
    for (const s of room.seats) s.cash = opts.cash;
  }
  return room;
}

export function giveProperty(room, seatIndex, spaceIndex, opts = {}) {
  room.properties[spaceIndex] = {
    ownerSeat: seatIndex,
    mortgaged: !!opts.mortgaged,
    houses: opts.houses ?? 0
  };
}

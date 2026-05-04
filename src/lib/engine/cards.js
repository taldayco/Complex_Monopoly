import { CHANCE_CARDS } from '../shared/chance.js';
import { COMMUNITY_CHEST_CARDS } from '../shared/communityChest.js';

const DECKS = {
  chance: CHANCE_CARDS,
  communityChest: COMMUNITY_CHEST_CARDS
};

export function cardById(deckName, id) {
  return DECKS[deckName]?.find((c) => c.id === id) ?? null;
}

// Draw the top card from `deckName`. Returns { card, deckState }.
// If the deck is empty, reshuffle from discard using rng. Mutates state.
export function drawCard(state, deckName, rng) {
  const deck = state[deckName];
  if (deck.deck.length === 0) {
    deck.deck = shuffle(deck.discard, rng);
    deck.discard = [];
  }
  const id = deck.deck.shift();
  const card = cardById(deckName, id);
  return { card, id };
}

export function returnCardToDiscard(state, deckName, id) {
  state[deckName].discard.push(id);
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

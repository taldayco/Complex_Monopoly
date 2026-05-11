import { CHANCE_CARDS } from '../shared/chance.js';
import { COMMUNITY_CHEST_CARDS } from '../shared/communityChest.js';
import { shuffled } from '../shared/rng/seeded.js';

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
    if (deck.discard.length === 0) return { card: null, id: null };
    deck.deck = shuffled(deck.discard, rng);
    deck.discard = [];
  }
  const id = deck.deck.shift();
  const card = cardById(deckName, id);
  return { card, id };
}

export function returnCardToDiscard(state, deckName, id) {
  state[deckName].discard.push(id);
}

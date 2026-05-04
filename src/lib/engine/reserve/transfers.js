// Player-to-player money transfers. Two flows:
//   1. wireTransfer — instant: sender debits, receiver credits.
//   2. transferRequest — sender of the request is the would-be receiver; the
//      target seat must approve before any cash moves.
//
// All helpers mutate the state slice they are given; the reducer wraps every
// call in a structuredClone of the room.

let TRANSFER_ID_COUNTER = 0;
function genTransferId() {
  TRANSFER_ID_COUNTER += 1;
  return `TR-${TRANSFER_ID_COUNTER}-${Date.now()}`;
}

function sanitizeAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function sanitizeNote(note) {
  if (typeof note !== 'string') return '';
  return note.trim().slice(0, 80);
}

// ---------- INSTANT WIRE ----------

export function doWireTransfer(state, fromSeatIdx, toSeatIdx, amount) {
  const sender = state.seats[fromSeatIdx];
  const receiver = state.seats[toSeatIdx];
  if (!sender || !receiver) return { error: 'NO_SEAT' };
  if (fromSeatIdx === toSeatIdx) return { error: 'SAME_SEAT' };
  if (sender.bankrupt) return { error: 'BANKRUPT' };
  const amt = sanitizeAmount(amount);
  if (amt == null) return { error: 'BAD_AMOUNT' };
  if (sender.cash < amt) return { error: 'INSUFFICIENT_FUNDS' };

  sender.cash = Math.round((sender.cash - amt) * 100) / 100;
  receiver.cash = Math.round((receiver.cash + amt) * 100) / 100;
  return { ok: true, amount: amt };
}

// ---------- REQUEST FLOW ----------

export function createTransferRequest(state, fromSeatIdx, toSeatIdx, amount, note) {
  const requester = state.seats[fromSeatIdx];
  const target = state.seats[toSeatIdx];
  if (!requester || !target) return { error: 'NO_SEAT' };
  if (fromSeatIdx === toSeatIdx) return { error: 'SAME_SEAT' };
  if (requester.bankrupt) return { error: 'BANKRUPT' };
  if (target.bankrupt) return { error: 'TARGET_BANKRUPT' };
  const amt = sanitizeAmount(amount);
  if (amt == null) return { error: 'BAD_AMOUNT' };

  state.pendingTransfers = Array.isArray(state.pendingTransfers) ? state.pendingTransfers : [];
  // Cap per-pair to prevent spam.
  const dupeCount = state.pendingTransfers.filter(
    (t) => t.fromSeat === fromSeatIdx && t.toSeat === toSeatIdx && t.status === 'pending'
  ).length;
  if (dupeCount >= 3) return { error: 'TOO_MANY_PENDING' };

  const req = {
    id: genTransferId(),
    fromSeat: fromSeatIdx,  // requester (would receive cash)
    toSeat: toSeatIdx,      // target (would pay cash on approve)
    amount: amt,
    note: sanitizeNote(note),
    createdAt: Date.now(),
    status: 'pending'
  };
  state.pendingTransfers.push(req);
  return { ok: true, request: req };
}

export function respondTransferRequest(state, requestId, responderSeatIdx, approve) {
  const list = Array.isArray(state.pendingTransfers) ? state.pendingTransfers : [];
  const idx = list.findIndex((t) => t.id === requestId && t.status === 'pending');
  if (idx === -1) return { error: 'NO_REQUEST' };
  const req = list[idx];
  if (req.toSeat !== responderSeatIdx) return { error: 'NOT_TARGET' };

  if (!approve) {
    list.splice(idx, 1);
    return { ok: true, approved: false, request: req };
  }

  // Approve: target pays requester.
  const target = state.seats[req.toSeat];
  const requester = state.seats[req.fromSeat];
  if (!target || !requester) return { error: 'NO_SEAT' };
  if (target.bankrupt) return { error: 'BANKRUPT' };
  if (target.cash < req.amount) return { error: 'INSUFFICIENT_FUNDS' };
  target.cash = Math.round((target.cash - req.amount) * 100) / 100;
  requester.cash = Math.round((requester.cash + req.amount) * 100) / 100;
  list.splice(idx, 1);
  return { ok: true, approved: true, request: req };
}

export function cancelTransferRequest(state, requestId, requesterSeatIdx) {
  const list = Array.isArray(state.pendingTransfers) ? state.pendingTransfers : [];
  const idx = list.findIndex((t) => t.id === requestId && t.status === 'pending');
  if (idx === -1) return { error: 'NO_REQUEST' };
  const req = list[idx];
  if (req.fromSeat !== requesterSeatIdx) return { error: 'NOT_REQUESTER' };
  list.splice(idx, 1);
  return { ok: true, request: req };
}

// Player-to-player money transfers: instant wire + request/approve flow. Each
// handler delegates to engine/reserve/transfers.js and emits the matching log
// event.

import {
  doWireTransfer,
  createTransferRequest,
  respondTransferRequest,
  cancelTransferRequest
} from '../reserve/transfers.js';

export function doWireAction(state, action, ctx, log) {
  const r = doWireTransfer(state, action.seat, action.toSeat, action.amount);
  if (!r.ok) return { error: r.error };
  log('wireTransfer', action.seat, {
    fromSeat: action.seat,
    toSeat: action.toSeat,
    amount: r.amount
  });
  return {};
}

export function doRequestTransferAction(state, action, ctx, log) {
  const r = createTransferRequest(state, action.seat, action.toSeat, action.amount, action.note);
  if (!r.ok) return { error: r.error };
  log('transferRequested', action.seat, {
    requestId: r.request.id,
    fromSeat: r.request.fromSeat,
    toSeat: r.request.toSeat,
    amount: r.request.amount,
    note: r.request.note
  });
  return {};
}

export function doRespondTransferAction(state, action, ctx, log) {
  const r = respondTransferRequest(state, action.requestId, action.seat, !!action.approve);
  if (!r.ok) return { error: r.error };
  log(r.approved ? 'transferApproved' : 'transferDenied', action.seat, {
    requestId: r.request.id,
    fromSeat: r.request.fromSeat,
    toSeat: r.request.toSeat,
    amount: r.request.amount
  });
  return {};
}

export function doCancelTransferAction(state, action, ctx, log) {
  const r = cancelTransferRequest(state, action.requestId, action.seat);
  if (!r.ok) return { error: r.error };
  log('transferCancelled', action.seat, {
    requestId: r.request.id,
    amount: r.request.amount
  });
  return {};
}

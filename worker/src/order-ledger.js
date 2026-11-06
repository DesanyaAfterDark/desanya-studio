import { handleRequest } from './handler.js';
import { createLedger, sqlStore } from './ledger.js';

export class OrderLedger {
  constructor(ctx, env) {
    this.env = env;
    this.ledger = null;
    ctx.blockConcurrencyWhile(async () => {
      this.ledger = createLedger(sqlStore(ctx.storage.sql));
    });
  }

  fetch(request) {
    return handleRequest(request, this.env, { ledger: this.ledger });
  }
}

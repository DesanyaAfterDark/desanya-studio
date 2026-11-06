import { handleRequest, resetPayPalTokenCache } from './handler.js';

export { handleRequest, resetPayPalTokenCache };
export { OrderLedger } from './order-ledger.js';

export default {
  fetch(request, env) {
    const binding = env && env.ORDER_LEDGER;
    if (!binding || typeof binding.idFromName !== 'function' || typeof binding.get !== 'function') {
      return handleRequest(request, env || {}, {});
    }
    const id = binding.idFromName('desanya-orders');
    return binding.get(id).fetch(request);
  }
};

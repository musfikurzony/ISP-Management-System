// OPTIONAL scheduled worker (Cloudflare Cron Trigger).
// Cloudflare Pages cannot run timed jobs by itself, so this tiny separate Worker
// wakes up once a day and creates the monthly bills when the billing date arrives.
// It uses exactly the same billing code as the main application, and the billing
// code is idempotent, so running it every day can never create duplicate bills.
//
// The application also has a built-in fallback: if this worker is not installed,
// the bills are generated the first time someone opens the Dashboard on or after
// the billing date.
import { runAutoBillingIfDue } from '../server/billing.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runAutoBillingIfDue(env.DB).then((result) => {
        console.log('auto billing:', result ? JSON.stringify(result) : 'nothing to do today');
      })
    );
  },
  async fetch() {
    return new Response('ISP billing scheduler is running. It has no public pages.', { status: 200 });
  },
};

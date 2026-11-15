// Cloudflare Pages Function: every request to /api/* arrives here
// and is passed to the application router in /server.
import { handleApi } from '../../server/router.js';

export const onRequest = (context) => handleApi(context.request, context.env);

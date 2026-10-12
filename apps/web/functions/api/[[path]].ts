/**
 * Pages Function: /api/* on bid-wit-me.pages.dev → the game Worker (service binding API = bid-wit-me-server).
 * Keeps accounts + sign-in same-origin, so the session cookie is first-party (Safari blocks third-party cookies),
 * and makes the OAuth callback URLs live on bid-wit-me.pages.dev. The original URL is passed through unchanged.
 */
interface Env { API: { fetch(req: Request): Promise<Response> } }

export const onRequest = async (ctx: { request: Request; env: Env }): Promise<Response> => ctx.env.API.fetch(ctx.request);

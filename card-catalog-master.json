// This legacy Pages Function is intentionally disabled.
//
// It previously accepted unauthenticated reads and writes to one shared GitHub
// file. The site now uses cloudflare-worker.js, which authenticates the session
// and resolves a separate data file for each user.
export async function onRequest() {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Legacy sync endpoint disabled; use the authenticated Worker.',
    }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}

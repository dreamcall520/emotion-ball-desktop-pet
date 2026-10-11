export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return env.FEEDBACK_SERVICE.fetch(request);
    let response;
    if (url.pathname === '/admin') response = new Response(null, { status: 302, headers: { Location: '/admin/' } });
    else response = await env.ASSETS.fetch(request);
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return response;
  }
};

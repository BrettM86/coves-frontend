// Loaded synchronously from app.html <head>, before first paint, so a reload
// doesn't flash the wrong colour scheme or the default theme colours. Reads
// the 'colorScheme' and 'theme.vars' keys written by
// src/lib/app/state/theme/theme.svelte.ts, and the <html>
// data-default-color-scheme attribute written by src/hooks.server.ts. Plain
// ES5 on purpose: it runs outside the bundle. Any failure leaves the
// server-rendered page as it is.
;(function () {
  try {
    var html = document.documentElement
    var scheme = null
    try {
      scheme = localStorage.getItem('colorScheme')
    } catch (_storageError) {
      // Storage blocked: fall through to the instance default below.
    }
    // First visit: fall back to the instance default hooks.server.ts stamps.
    if (scheme !== 'system' && scheme !== 'light' && scheme !== 'dark') {
      scheme = html.getAttribute('data-default-color-scheme')
    }
    if (scheme === 'system') {
      scheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    // No stored or default scheme: keep the class the server rendered.
    if (scheme === 'dark') html.classList.add('dark')
    else if (scheme === 'light') html.classList.remove('dark')

    // Only the declarations calculateVars writes (shades are numbers, or
    // black/white in 'other'), so a tampered value can't put arbitrary CSS on
    // <html>.
    var vars = localStorage.getItem('theme.vars')
    var varsShape =
      /^(\s*--color-[a-z]+-[a-z0-9]+:rgb\(\d{1,3} \d{1,3} \d{1,3}\);)+\s*$/
    if (vars && varsShape.test(vars)) html.setAttribute('style', vars)
  } catch (_error) {
    // Storage blocked or matchMedia missing: the page still renders.
  }
})()

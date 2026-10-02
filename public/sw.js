/*
 * Tempest's service worker.
 *
 * What it does, and no more:
 *
 *   - Pages are fetched from the network, and when there is none, the
 *     offline page is shown instead of the browser's error. Nothing the app
 *     reads is served stale: every report, approval and reading of the town
 *     still comes from the server.
 *   - Hashed static assets and the icons are kept once fetched, since they
 *     never change under their names.
 *   - A push message becomes a notification, and tapping it opens the page
 *     it names.
 *
 * Classic script, no imports, so every browser that can install the app can
 * run it. The routing decision is a plain function at the top so it can be
 * tested outside a browser.
 */

var CACHE = 'tempest-static-v1';
var OFFLINE_URL = '/offline';
var PRECACHE = [OFFLINE_URL, '/manifest.json', '/icon.png', '/icons/icon-192x192.png', '/icons/icon-512x512.png'];

/**
 * How a request is served: 'page' (network, offline page as the fallback),
 * 'static' (cache first), or 'network' (never cached).
 */
function strategyFor(url, mode) {
    if (mode === 'navigate') return 'page';
    var path = url.pathname;
    if (path.indexOf('/_next/static/') === 0) return 'static';
    if (path.indexOf('/icons/') === 0 || path === '/icon.png' || path === '/apple-icon.png' || path === '/favicon.ico' || path === '/manifest.json') return 'static';
    return 'network';
}

self.__tempest = { strategyFor: strategyFor, CACHE: CACHE, OFFLINE_URL: OFFLINE_URL };

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches
            .open(CACHE)
            .then(function (cache) {
                // Best effort: a missing icon must not stop the worker installing.
                return Promise.all(
                    PRECACHE.map(function (u) {
                        return cache.add(u).catch(function () {});
                    })
                );
            })
            .then(function () {
                return self.skipWaiting();
            })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches
            .keys()
            .then(function (keys) {
                return Promise.all(
                    keys.filter(function (k) {
                        return k !== CACHE;
                    }).map(function (k) {
                        return caches.delete(k);
                    })
                );
            })
            .then(function () {
                return self.clients.claim();
            })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET') return;
    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    var strategy = strategyFor(url, request.mode);

    if (strategy === 'page') {
        event.respondWith(
            fetch(request).catch(function () {
                return caches.match(OFFLINE_URL).then(function (hit) {
                    return hit || new Response('You are offline.', { status: 503, headers: { 'content-type': 'text/plain' } });
                });
            })
        );
        return;
    }

    if (strategy === 'static') {
        event.respondWith(
            caches.match(request).then(function (hit) {
                if (hit) return hit;
                return fetch(request).then(function (res) {
                    if (res && res.ok) {
                        var copy = res.clone();
                        caches.open(CACHE).then(function (cache) {
                            cache.put(request, copy);
                        });
                    }
                    return res;
                });
            })
        );
    }
    // 'network': the browser does what it always did.
});

self.addEventListener('push', function (event) {
    var data = { title: 'Tempest', body: '', url: '/dashboard/delphi', tag: 'tempest' };
    try {
        if (event.data) data = Object.assign(data, event.data.json());
    } catch (e) {
        if (event.data) data.body = event.data.text();
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            tag: data.tag,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/icon-192x192.png',
            data: { url: data.url },
        })
    );
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var url = (event.notification.data && event.notification.data.url) || '/dashboard/delphi';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
            for (var i = 0; i < list.length; i++) {
                if ('focus' in list[i]) {
                    list[i].navigate(url);
                    return list[i].focus();
                }
            }
            return self.clients.openWindow(url);
        })
    );
});

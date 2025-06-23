'use strict';
// Reusable fetch mocking utilities

export function createMockFetch(responses = {}) {
    let callCount = 0;

    return (url, options) => {
        callCount++;
        const method = options?.method || 'GET';
        const key = `${method} ${url}`;

        if (responses[key]) {
            return Promise.resolve(responses[key]);
        }

        // Default responses by URL pattern
        if (url.includes('/404')) {
            return Promise.resolve({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                headers: new Map(),
                url
            });
        }

        if (url.includes('/timeout')) {
            return new Promise(() => {}); // Never resolves
        }

        if (url.includes('/network-fail')) {
            return Promise.reject(new Error('Network connection failed'));
        }

        // Default success
        return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Map([['content-type', 'application/json']]),
            url,
            json: () => Promise.resolve({
                id: callCount,
                data: `response-${callCount}`,
                timestamp: Date.now()
            })
        });
    };
}

export function createSlowMock(delayMs = 100) {
    return (url, options) => {
        return new Promise((resolve, reject) => {
            const abortHandler = () => {
                reject(new DOMException('The operation was aborted', 'AbortError'));
            };

            if (options?.signal) {
                if (options.signal.aborted) {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                    return;
                }
                options.signal.addEventListener('abort', abortHandler, { once: true });
            }

            setTimeout(() => {
                if (options?.signal) {
                    options.signal.removeEventListener('abort', abortHandler);
                }

                resolve({
                    ok: true,
                    status: 200,
                    headers: new Map([['content-type', 'application/json']]),
                    url,
                    json: () => Promise.resolve({ delayed: true, url })
                });
            }, delayMs);
        });
    };
}
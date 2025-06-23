#!/usr/bin/env node
'use strict';

import assert from 'assert';
import { Grab, HttpError, NetworkError, TimeoutError } from '../../src/Grab.js';

const { ok, strictEqual, fail } = assert;

const createHttpMock = (status, statusText = 'Error', body = null) => {
    return () => Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText,
        headers: new Map([['content-type', 'application/json']]),
        url: 'https://test.com/api',
        json: () => Promise.resolve(body || { error: `HTTP ${status}` })
    });
};

const test = (name, fn) => fn().then(() => console.log(`✓ ${name}`));

// Test: Basic 4xx errors
async function testClientErrors() {
    const statuses = [400, 401, 403, 404, 422];

    for (const status of statuses) {
        global.fetch = createHttpMock(status, `Client Error ${status}`);

        const api = new Grab({ retry: { attempts: 1 } });

        try {
            await api.get('/test');
            fail(`Should have thrown HttpError for ${status}`);
        } catch (error) {
            ok(error instanceof HttpError, `${status} should be HttpError`);
            strictEqual(error.status, status, `Status should be ${status}`);
            ok(error.message.includes(status.toString()), 'Message should include status');
        }
    }

    delete global.fetch;
}

// Test: Basic 5xx errors
async function testServerErrors() {
    const statuses = [500, 502, 503, 504];

    for (const status of statuses) {
        global.fetch = createHttpMock(status, `Server Error ${status}`);

        const api = new Grab({ retry: { attempts: 1 } });

        try {
            await api.get('/test');
            fail(`Should have thrown HttpError for ${status}`);
        } catch (error) {
            ok(error instanceof HttpError, `${status} should be HttpError`);
            strictEqual(error.status, status, `Status should be ${status}`);
        }
    }

    delete global.fetch;
}

// Test: Error response body preservation
async function testErrorResponseBody() {
    const errorBody = {
        error: 'validation_failed',
        details: ['name is required', 'email is invalid']
    };

    global.fetch = createHttpMock(422, 'Unprocessable Entity', errorBody);

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('/test');
        fail('Should have thrown HttpError');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        ok(error.response, 'Should have response object');
        strictEqual(error.status, 422, 'Status should be preserved');
    }

    delete global.fetch;
}

// Test: URL preservation in errors
async function testUrlPreservation() {
    global.fetch = createHttpMock(404, 'Not Found');

    const api = new Grab({
        baseUrl: 'https://api.example.com',
        retry: { attempts: 1 }
    });

    try {
        await api.get('/users/nonexistent');
        fail('Should have thrown HttpError');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        ok(error.url, 'Should have URL');
        ok(error.url.includes('/users/nonexistent'), 'URL should include endpoint');
    }

    delete global.fetch;
}

// Test: Status code edge cases
async function testStatusEdgeCases() {
    // Test 418 I'm a teapot (should not retry)
    // This is the most important test
    global.fetch = createHttpMock(418, "I'm a teapot");

    const api = new Grab({ retry: { attempts: 3 } });
    let attempts = 0;

    const originalFetch = global.fetch;
    global.fetch = (...args) => {
        attempts++;
        return originalFetch(...args);
    };

    try {
        await api.get('/coffee');
        fail('Should have thrown HttpError');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        strictEqual(error.status, 418, 'Status should be 418');
        strictEqual(attempts, 1, '418 should not be retried');
    }

    delete global.fetch;
}

// Test: 304 Not Modified handling (special case)
async function testNotModified() {
    global.fetch = () => Promise.resolve({
        ok: true,  // 304 is technically "ok" in some contexts
        status: 304,
        statusText: 'Not Modified',
        headers: new Map([['etag', '"abc123"']]),
        url: 'https://test.com/api',
        json: () => Promise.resolve(null)
    });

    const api = new Grab();

    const response = await api.get('/data');
    strictEqual(response.status, 304, 'Should handle 304 gracefully');

    delete global.fetch;
}

// Test: Custom error properties
async function testCustomErrorProperties() {
    global.fetch = createHttpMock(403, 'Forbidden');

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('/admin');
        fail('Should have thrown HttpError');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        strictEqual(error.name, 'HttpError', 'Name should be HttpError');
        ok(error.stack, 'Should have stack trace');
        ok(error.toString().includes('403'), 'toString should include status');
    }

    delete global.fetch;
}

// Test: Rate limiting (429) special handling
async function testRateLimiting() {
    global.fetch = () => Promise.resolve({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Map([
            ['retry-after', '60'],
            ['content-type', 'application/json']
        ]),
        url: 'https://test.com/api',
        json: () => Promise.resolve({ error: 'rate_limited' })
    });

    const api = new Grab({
        retry: { attempts: 1 },  // Note: Disable retries for this test
        respectRetryAfter: true
    });

    try {
        await api.get('/api/data');
        fail('Should have thrown HttpError for 429');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        strictEqual(error.status, 429, 'Status should be 429');
        // Note: retry logic is tested elsewhere
    }

    delete global.fetch;
}

// Main test runner
async function runHttpErrorTests() {
    console.log('🧪 HTTP Error Tests\n');

    const startTime = Date.now();

    try {
        await test('client errors (4xx)', testClientErrors);
        await test('server errors (5xx)', testServerErrors);
        await test('error response body preservation', testErrorResponseBody);
        await test('URL preservation in errors', testUrlPreservation);
        await test('status code edge cases', testStatusEdgeCases);
        await test('304 Not Modified handling', testNotModified);
        await test('custom error properties', testCustomErrorProperties);
        await test('rate limiting (429)', testRateLimiting);

        const duration = Date.now() - startTime;
        console.log(`\n✅ All HTTP error tests passed (${duration}ms)`);

    } catch (error) {
        console.error('❌ HTTP error test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

process.on('exit', () => {
    if (global.fetch) delete global.fetch;
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
    runHttpErrorTests();
}

export { runHttpErrorTests };
#!/usr/bin/env node
'use strict';
import assert from 'assert';
import { Grab, HttpError, NetworkError, TimeoutError } from '../../src/Grab.js';

const { ok, strictEqual, fail } = assert;

const createNetworkErrorMock = (errorType, message) => {
    return () => {
        const error = new Error(message);
        error.code = errorType;
        return Promise.reject(error);
    };
};

const test = (name, fn) => fn().then(() => console.log(`✓ ${name}`));

// Test: Basic connection failures
async function testConnectionFailures() {
    const errors = [
        { code: 'ECONNREFUSED', message: 'Connection refused' },
        { code: 'ENOTFOUND', message: 'Host not found' },
        { code: 'ECONNRESET', message: 'Connection reset by peer' },
        { code: 'ETIMEDOUT', message: 'Connection timed out' }
    ];

    for (const { code, message } of errors) {
        global.fetch = createNetworkErrorMock(code, message);

        const api = new Grab({ retry: { attempts: 1 } });

        try {
            await api.get('/test');
            fail(`Should have thrown NetworkError for ${code}`);
        } catch (error) {
            ok(error instanceof NetworkError, `${code} should be NetworkError`);
            strictEqual(error.name, 'NetworkError', 'Name should be NetworkError');
            ok(error.message.includes(message), 'Should preserve original message');
        }
    }

    delete global.fetch;
}

// Test: DNS resolution failures
async function testDnsFailures() {
    global.fetch = createNetworkErrorMock('ENOTFOUND', 'getaddrinfo ENOTFOUND nonexistent.domain.com');

    const api = new Grab({
        baseUrl: 'https://nonexistent.domain.com',
        retry: { attempts: 1 }
    });

    try {
        await api.get('/api/data');
        fail('Should have thrown NetworkError for DNS failure');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        ok(error.url, 'Should preserve request URL');
        ok(error.url.includes('nonexistent.domain.com'), 'URL should include domain');
    }

    delete global.fetch;
}

// Test: Network error during response reading
async function testResponseReadingError() {
    global.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'application/json']]),
        url: 'https://test.com/api',
        json: () => Promise.reject(new Error('Connection lost while reading response'))
    });

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('/data');
        fail('Should have thrown NetworkError');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        ok(error.message.includes('Connection lost'), 'Should preserve error message');
    }

    delete global.fetch;
}

// Test: Intermittent network failures
async function testIntermittentFailures() {
    let attempts = 0;

    global.fetch = () => {
        attempts++;
        if (attempts <= 2) {
            return Promise.reject(new Error('Network temporarily unavailable'));
        }
        // Third attempt succeeds
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            url: 'https://test.com/api',
            json: () => Promise.resolve({ success: true })
        });
    };

    const api = new Grab({ retry: { attempts: 3 } });

    // Note: This should eventually succeed after retries
    const response = await api.get('/flaky-endpoint');
    ok(response.data.success, 'Should eventually succeed');
    strictEqual(attempts, 3, 'Should have made 3 attempts');

    delete global.fetch;
}

// Test: URL preservation in network errors
async function testUrlPreservation() {
    global.fetch = createNetworkErrorMock('ECONNREFUSED', 'Connection refused');

    const api = new Grab({
        baseUrl: 'https://api.example.com',
        retry: { attempts: 1 }
    });

    try {
        await api.get('/users/123');
        fail('Should have thrown NetworkError');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        ok(error.url, 'Should have URL property');
        ok(error.url.includes('/users/123'), 'URL should include endpoint');
        ok(error.url.includes('api.example.com'), 'URL should include base URL');
    }

    delete global.fetch;
}

// Test: Network error vs other error types
async function testErrorTypeDistinction() {
    // Network error
    global.fetch = createNetworkErrorMock('ECONNRESET', 'Connection reset');

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('/test');
        fail('Should have thrown NetworkError');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        ok(!(error instanceof TypeError), 'Should not be TypeError');
        ok(error.url, 'Should have URL');
    }

    delete global.fetch;
}

// Test: Network error properties
async function testNetworkErrorProperties() {
    global.fetch = createNetworkErrorMock('ENOTFOUND', 'DNS lookup failed');

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('/test');
        fail('Should have thrown NetworkError');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        strictEqual(error.name, 'NetworkError', 'Name should be NetworkError');
        ok(error.message, 'Should have message');
        ok(error.stack, 'Should have stack trace');
        ok(error.url, 'Should have URL');
        ok(error.toString().includes('NetworkError'), 'toString should include type');
    }

    delete global.fetch;
}

// Test: TLS/SSL errors
async function testTlsErrors() {
    global.fetch = createNetworkErrorMock('CERT_UNTRUSTED', 'Certificate verification failed');

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('https://invalid-cert.example.com/api');
        fail('Should have thrown NetworkError for TLS error');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        ok(error.message.includes('Certificate'), 'Should preserve TLS error message');
    }

    delete global.fetch;
}

// Test: Fetch API TypeError handling
async function testFetchTypeError() {
    global.fetch = () => {
        const error = new TypeError('Failed to fetch');
        return Promise.reject(error);
    };

    const api = new Grab({ retry: { attempts: 1 } });

    try {
        await api.get('/test');
        fail('Should have thrown NetworkError');
    } catch (error) {
        ok(error instanceof NetworkError, 'TypeError should be converted to NetworkError');
        ok(error.message.includes('Failed to fetch'), 'Should preserve original message');
    }

    delete global.fetch;
}

// Test: Network retry conditions
async function testNetworkRetryConditions() {
    let attempts = 0;

    global.fetch = () => {
        attempts++;
        return Promise.reject(new Error('Network unreachable'));
    };

    const api = new Grab({
        retry: {
            attempts: 3,
            delay: 10  // Fast retries for testing
        }
    });

    try {
        await api.get('/test');
        fail('Should have thrown NetworkError after retries');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should be NetworkError');
        strictEqual(attempts, 3, 'Should have retried 3 times');
    }

    delete global.fetch;
}

// Main test runner
async function runNetworkErrorTests() {
    console.log('🌐 Network Error Tests\n');

    const startTime = Date.now();

    try {
        await test('connection failures', testConnectionFailures);
        await test('DNS resolution failures', testDnsFailures);
        await test('response reading errors', testResponseReadingError);
        await test('intermittent network failures', testIntermittentFailures);
        await test('URL preservation in network errors', testUrlPreservation);
        await test('network error type distinction', testErrorTypeDistinction);
        await test('network error properties', testNetworkErrorProperties);
        await test('TLS/SSL errors', testTlsErrors);
        await test('fetch API TypeError handling', testFetchTypeError);
        await test('network retry conditions', testNetworkRetryConditions);

        const duration = Date.now() - startTime;
        console.log(`\n✅ All network error tests passed (${duration}ms)`);

    } catch (error) {
        console.error('❌ Network error test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Cleanup
process.on('exit', () => {
    if (global.fetch) delete global.fetch;
});

// Auto-run if called directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    runNetworkErrorTests();
}

export { runNetworkErrorTests };
#!/usr/bin/env node
'use strict';
import assert from 'assert';
import { Grab, TimeoutError } from '../../src/Grab.js';

const { ok, strictEqual, fail } = assert;

const test = (name, fn) => fn().then(() => console.log(`✓ ${name}`));

const createSlowMock = (delayMs, shouldSucceed = true) => {
    return (url, options) => {
        return new Promise((resolve, reject) => {
            const abortHandler = () => {
                reject(new DOMException('The operation was aborted', 'AbortError'));
            };

            if (options.signal) {
                if (options.signal.aborted) {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                    return;
                }
                options.signal.addEventListener('abort', abortHandler, { once: true });
            }

            setTimeout(() => {
                if (options.signal) {
                    options.signal.removeEventListener('abort', abortHandler);
                }

                if (shouldSucceed) {
                    resolve({
                        ok: true,
                        status: 200,
                        headers: new Map([['content-type', 'application/json']]),
                        url: url,
                        json: () => Promise.resolve({ data: 'slow response' })
                    });
                } else {
                    reject(new Error('Slow request failed'));
                }
            }, delayMs);
        });
    };
};

// Test: Basic timeout behavior
async function testBasicTimeout() {
    global.fetch = createSlowMock(200); // 200ms response

    const api = new Grab({
        timeout: 50,  // 50ms timeout
        retry: { attempts: 1 }
    });

    try {
        await api.get('/slow');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
        strictEqual(error.name, 'TimeoutError', 'Name should be TimeoutError');
        strictEqual(error.timeout, 50, 'Should preserve timeout value');
    }

    delete global.fetch;
}

// Test: Timeout with successful fast response
async function testTimeoutWithFastResponse() {
    global.fetch = createSlowMock(10); // 10ms response

    const api = new Grab({
        timeout: 100,  // 100ms timeout
        retry: { attempts: 1 }
    });

    // Note: This should succeed without timeout
    const response = await api.get('/fast');
    ok(response.data, 'Should receive response data');
    strictEqual(response.status, 200, 'Should be successful');

    delete global.fetch;
}

// Test: Per-request timeout override
async function testPerRequestTimeout() {
    global.fetch = createSlowMock(100); // 100ms response

    const api = new Grab({
        timeout: 200,  // Default 200ms timeout
        retry: { attempts: 1 }
    });

    try {
        // Override with shorter timeout for this request
        await api.get('/slow', { timeout: 50 });
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
        strictEqual(error.timeout, 50, 'Should use per-request timeout');
    }

    delete global.fetch;
}

// Test: Timeout error properties
async function testTimeoutErrorProperties() {
    global.fetch = createSlowMock(200);

    const api = new Grab({
        baseUrl: 'https://api.example.com',
        timeout: 50,
        retry: { attempts: 1 }
    });

    try {
        await api.get('/timeout-test');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
        strictEqual(error.name, 'TimeoutError', 'Name should be TimeoutError');
        ok(error.url, 'Should have URL property');
        ok(error.url.includes('/timeout-test'), 'URL should include endpoint');
        ok(error.timeout, 'Should have timeout property');
        ok(error.message, 'Should have message');
        ok(error.stack, 'Should have stack trace');
        ok(error.message.includes('50ms'), 'Message should include timeout value');
        ok(error.toString().includes('TimeoutError'), 'toString should include type');
    }

    delete global.fetch;
}

// Test: External abort signal
async function testExternalAbortSignal() {
    global.fetch = createSlowMock(200);

    const api = new Grab({
        timeout: 500,  // Long timeout
        retry: { attempts: 1 }
    });

    const controller = new AbortController();

    // Abort after 50ms
    setTimeout(() => controller.abort(), 50);

    try {
        await api.get('/slow', { signal: controller.signal });
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError for external abort');
    }

    delete global.fetch;
}

// Test: Timeout during response parsing
async function testTimeoutDuringParsing() {
    global.fetch = (url, options) => {
        return new Promise((resolve, reject) => {
            const abortHandler = () => {
                reject(new DOMException('The operation was aborted', 'AbortError'));
            };

            if (options.signal) {
                if (options.signal.aborted) {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                    return;
                }
                options.signal.addEventListener('abort', abortHandler, { once: true });
            }

            setTimeout(() => {
                if (options.signal) {
                    options.signal.removeEventListener('abort', abortHandler);
                }

                resolve({
                    ok: true,
                    status: 200,
                    headers: new Map([['content-type', 'application/json']]),
                    url: url,
                    json: () => new Promise(() => {}) // Never resolves
                });
            }, 10);
        });
    };

    const api = new Grab({
        timeout: 50,
        retry: { attempts: 1 }
    });

    try {
        await api.get('/slow-parse');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
    }

    delete global.fetch;
}

// Test: Timeout with retries
async function testTimeoutWithRetries() {
    let attempts = 0;

    global.fetch = (url, options) => {
        attempts++;
        return createSlowMock(200)(url, options);
    };

    const api = new Grab({
        timeout: 50,
        retry: {
            attempts: 3,
            delay: 10
        }
    });

    try {
        await api.get('/always-slow');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
        strictEqual(attempts, 3, 'Should have retried on timeout');
    }

    delete global.fetch;
}

// Test: Zero timeout edge case
async function testZeroTimeout() {
    global.fetch = createSlowMock(10);

    const api = new Grab({
        timeout: 0,  // Immediate timeout
        retry: { attempts: 1 }
    });

    try {
        await api.get('/test');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
        strictEqual(error.timeout, 0, 'Should preserve zero timeout');
    }

    delete global.fetch;
}

// Test: Large timeout values
async function testLargeTimeout() {
    global.fetch = createSlowMock(10); // Fast response

    const api = new Grab({
        timeout: 60000,  // 1 minute timeout
        retry: { attempts: 1 }
    });

    const response = await api.get('/fast');
    ok(response.data, 'Should receive response');

    delete global.fetch;
}

// Test: AbortError distinction
async function testAbortErrorHandling() {
    global.fetch = createSlowMock(200);

    const api = new Grab({
        timeout: 50,
        retry: { attempts: 1 }
    });

    try {
        await api.get('/slow');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'AbortError should become TimeoutError');
        ok(error.message.includes('timeout'), 'Message should indicate timeout');
        ok(!error.message.includes('abort'), 'Message should not mention abort');
    }

    delete global.fetch;
}

// Test: Timeout error vs network error
async function testTimeoutVsNetworkError() {
    // First test: timeout
    global.fetch = createSlowMock(200);

    const api = new Grab({
        timeout: 50,
        retry: { attempts: 1 }
    });

    try {
        await api.get('/slow');
        fail('Should have thrown TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should be TimeoutError');
        ok(error.timeout, 'Should have timeout property');
    }

    // Second test: actual network error
    global.fetch = () => Promise.reject(new Error('Network failed'));

    try {
        await api.get('/network-fail');
        fail('Should have thrown NetworkError');
    } catch (error) {
        ok(error.name === 'NetworkError', 'Should be NetworkError, not TimeoutError');
        ok(!error.timeout, 'Should not have timeout property');
    }

    delete global.fetch;
}

// Main test runner
async function runTimeoutErrorTests() {
    console.log('⏱️  Timeout Error Tests\n');

    const startTime = Date.now();

    try {
        await test('basic timeout behavior', testBasicTimeout);
        await test('timeout with fast response', testTimeoutWithFastResponse);
        await test('per-request timeout override', testPerRequestTimeout);
        await test('timeout error properties', testTimeoutErrorProperties);
        await test('external abort signal', testExternalAbortSignal);
        await test('timeout during response parsing', testTimeoutDuringParsing);
        await test('timeout with retries', testTimeoutWithRetries);
        await test('zero timeout edge case', testZeroTimeout);
        await test('large timeout values', testLargeTimeout);
        await test('AbortError distinction', testAbortErrorHandling);
        await test('timeout vs network error', testTimeoutVsNetworkError);

        const duration = Date.now() - startTime;
        console.log(`\n✅ All timeout error tests passed (${duration}ms)`);

    } catch (error) {
        console.error('❌ Timeout error test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

process.on('exit', () => {
    if (global.fetch) delete global.fetch;
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
    runTimeoutErrorTests();
}

export { runTimeoutErrorTests };
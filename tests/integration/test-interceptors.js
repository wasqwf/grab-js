#!/usr/bin/env node
'use strict';

import assert from 'assert';
import { Grab, HttpError, NetworkError, TimeoutError } from '../../src/Grab.js';

const { ok, strictEqual, fail, deepStrictEqual } = assert;

const test = (name, fn) => fn().then(() => console.log(`✓ ${name}`));

const createMockFetch = (responseOverrides = {}) => {
    return (url, options) => {
        if (url.includes('/404')) {
            return Promise.resolve({
                ok: false,
                status: 404,
                statusText: 'Not Found',
                headers: new Map(),
                url
            });
        }

        if (url.includes('/network-fail')) {
            return Promise.reject(new Error('Network connection failed'));
        }

        if (url.includes('/timeout')) {
            return new Promise(() => {}); // Never resolves
        }

        // Default success response
        return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Map([['content-type', 'application/json']]),
            url,
            json: () => Promise.resolve({ success: true, url }),
            ...responseOverrides
        });
    };
};

// Test: Basic request interceptor
async function testRequestInterceptor() {
    global.fetch = createMockFetch();

    const api = new Grab({ retry: { attempts: 1 } });
    const interceptedRequests = [];

    api.use({
        request: (config) => {
            interceptedRequests.push(config);
            config.headers = {
                ...config.headers,
                'X-Intercepted': 'true'
            };
            return config;
        }
    });

    await api.get('/test');

    strictEqual(interceptedRequests.length, 1, 'Request interceptor should be called');
    ok(interceptedRequests[0].headers['X-Intercepted'], 'Should add custom header');

    delete global.fetch;
}

// Test: Basic response interceptor
async function testResponseInterceptor() {
    global.fetch = createMockFetch();

    const api = new Grab();
    const interceptedResponses = [];

    api.use({
        response: (response) => {
            interceptedResponses.push(response);
            response.intercepted = true;
            return response;
        }
    });

    const response = await api.get('/test');

    strictEqual(interceptedResponses.length, 1, 'Response interceptor should be called');
    ok(response.intercepted, 'Should modify response');

    delete global.fetch;
}

// Test: Error interceptor with proper re-throwing
async function testErrorInterceptorRethrow() {
    global.fetch = createMockFetch();

    const api = new Grab({ retry: { attempts: 1 } });
    const interceptedErrors = [];

    api.use({
        error: (error) => {
            interceptedErrors.push(error);
            throw error;
        }
    });

    try {
        await api.get('/404');
        fail('Should have thrown HttpError');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        strictEqual(error.status, 404, 'Status should be preserved');
        strictEqual(interceptedErrors.length, 1, 'Error interceptor should be called');
        strictEqual(interceptedErrors[0].status, 404, 'Interceptor should receive original error');
    }

    delete global.fetch;
}

// Test: Silent error interceptor (forgot to re-throw)
async function testSilentErrorInterceptor() {
    global.fetch = createMockFetch();

    const api = new Grab({ retry: { attempts: 1 } });
    const interceptedErrors = [];

    api.use({
        error: (error) => {
            interceptedErrors.push(error);
            console.log(`   Silent interceptor caught: ${error.name}`);
            // Note: Not re-throwing here on purpose to test the behavior
        }
    });

    try {
        await api.get('/404');
        fail('Should still throw HttpError despite silent interceptor');
    } catch (error) {
        ok(error instanceof HttpError, 'Error should still propagate');
        strictEqual(error.status, 404, 'Status should be preserved');
        strictEqual(interceptedErrors.length, 1, 'Interceptor should be called');
    }

    delete global.fetch;
}

// Test: Request interceptor throws error
async function testRequestInterceptorThrows() {
    global.fetch = createMockFetch();

    const api = new Grab();

    api.use({
        request: (config) => {
            if (config.url.includes('/forbidden')) {
                throw new Error('Request blocked by interceptor');
            }
            return config;
        }
    });

    try {
        await api.get('/forbidden');
        fail('Should have thrown interceptor error');
    } catch (error) {
        strictEqual(error.message, 'Request blocked by interceptor');
        ok(!(error instanceof HttpError), 'Should not be HttpError');
    }

    delete global.fetch;
}

// Test: Response interceptor throws error
async function testResponseInterceptorThrows() {
    global.fetch = createMockFetch();

    const api = new Grab();

    api.use({
        response: (response) => {
            if (response.data && response.data.success) {
                throw new Error('Response rejected by interceptor');
            }
            return response;
        }
    });

    try {
        await api.get('/test');
        fail('Should have thrown response interceptor error');
    } catch (error) {
        strictEqual(error.message, 'Response rejected by interceptor');
    }

    delete global.fetch;
}

// Test: Multiple interceptors in order
async function testMultipleInterceptorsOrder() {
    global.fetch = createMockFetch();

    const api = new Grab();
    const callOrder = [];

    // First request interceptor
    api.use({
        request: (config) => {
            callOrder.push('request-1');
            config.first = true;
            return config;
        }
    });

    // Second request interceptor
    api.use({
        request: (config) => {
            callOrder.push('request-2');
            ok(config.first, 'Should receive modifications from first interceptor');
            config.second = true;
            return config;
        }
    });

    // First response interceptor
    api.use({
        response: (response) => {
            callOrder.push('response-1');
            response.firstResponse = true;
            return response;
        }
    });

    // Second response interceptor
    api.use({
        response: (response) => {
            callOrder.push('response-2');
            ok(response.firstResponse, 'Should receive modifications from first response interceptor');
            response.secondResponse = true;
            return response;
        }
    });

    const response = await api.get('/test');

    deepStrictEqual(callOrder, ['request-1', 'request-2', 'response-1', 'response-2']);
    ok(response.firstResponse && response.secondResponse, 'Should apply all response modifications');

    delete global.fetch;
}

// Test: Error interceptor chain
async function testErrorInterceptorChain() {
    global.fetch = createMockFetch();

    const api = new Grab({ retry: { attempts: 1 } });
    const interceptorCalls = [];

    // First error interceptor
    api.use({
        error: (error) => {
            interceptorCalls.push('error-1');
            error.firstIntercepted = true;
            throw error;
        }
    });

    // Second error interceptor
    api.use({
        error: (error) => {
            interceptorCalls.push('error-2');
            ok(error.firstIntercepted, 'Should receive error from first interceptor');
            error.secondIntercepted = true;
            throw error;
        }
    });

    try {
        await api.get('/404');
        fail('Should have thrown error');
    } catch (error) {
        ok(error instanceof HttpError, 'Should be HttpError');
        ok(error.firstIntercepted && error.secondIntercepted, 'Should be modified by both interceptors');
        deepStrictEqual(interceptorCalls, ['error-1', 'error-2']);
    }

    delete global.fetch;
}

// Test: Async interceptors
async function testAsyncInterceptors() {
    global.fetch = createMockFetch();

    const api = new Grab();

    // Async request interceptor
    api.use({
        request: async (config) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            config.asyncProcessed = true;
            return config;
        }
    });

    // Async response interceptor
    api.use({
        response: async (response) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            response.asyncResponse = true;
            return response;
        }
    });

    const response = await api.get('/test');
    ok(response.asyncResponse, 'Async interceptors should work');

    delete global.fetch;
}

// Test: Async interceptor error handling
async function testAsyncInterceptorErrors() {
    global.fetch = createMockFetch();

    const api = new Grab();

    // Async request interceptor that fails
    api.use({
        request: async (config) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            if (config.url.includes('/async-fail')) {
                throw new Error('Async interceptor failed');
            }
            return config;
        }
    });

    try {
        await api.get('/async-fail');
        fail('Should have thrown async interceptor error');
    } catch (error) {
        strictEqual(error.message, 'Async interceptor failed');
    }

    delete global.fetch;
}

// Test: Error type preservation through interceptors
async function testErrorTypePreservation() {
    global.fetch = createMockFetch();

    const api = new Grab({
        timeout: 50,
        retry: { attempts: 1 },
        circuitBreaker: { failureThreshold: 999 }
    });

    const errorTypes = [];

    api.use({
        error: (error) => {
            errorTypes.push(error.constructor.name);
            throw error;
        }
    });

    try {
        await api.get('/404');
        fail('Should throw HttpError');
    } catch (error) {
        ok(error instanceof HttpError, 'Should preserve HttpError type');
    }

    try {
        await api.get('/network-fail');
        fail('Should throw NetworkError');
    } catch (error) {
        ok(error instanceof NetworkError, 'Should preserve NetworkError type');
    }

    global.fetch = (url, options) => {
        return new Promise((resolve, reject) => {
            if (options.signal) {
                const abortHandler = () => {
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                };
                options.signal.addEventListener('abort', abortHandler, { once: true });
            }
        });
    };

    try {
        await api.get('/timeout');
        fail('Should throw TimeoutError');
    } catch (error) {
        ok(error instanceof TimeoutError, 'Should preserve TimeoutError type');
    }

    ok(errorTypes.includes('HttpError'), 'Should have seen HttpError');
    ok(errorTypes.includes('NetworkError'), 'Should have seen NetworkError');
    ok(errorTypes.includes('TimeoutError'), 'Should have seen TimeoutError');

    delete global.fetch;
}

// Test: Interceptor modification of request config
async function testRequestConfigModification() {
    global.fetch = createMockFetch();

    const api = new Grab({ baseUrl: 'https://api.example.com' });

    api.use({
        request: (config) => {
            config.headers = {
                ...config.headers,
                'Authorization': 'Bearer test-token'
            };

            if (config.body && typeof config.body === 'object') {
                config.body.timestamp = Date.now();
            }

            return config;
        }
    });

    let fetchConfig;
    const originalFetch = global.fetch;
    global.fetch = (url, options) => {
        fetchConfig = options;
        return originalFetch(url, options);
    };

    await api.post('/test', { body: { data: 'test' } });

    ok(fetchConfig.headers['Authorization'], 'Should add auth header');
    ok(fetchConfig.headers['Authorization'].includes('Bearer'), 'Should add correct auth');

    delete global.fetch;
}

// Test: Interceptor with cache interaction
async function testInterceptorCacheInteraction() {
    global.fetch = createMockFetch();

    const api = new Grab();
    let responseCount = 0;

    api.use({
        response: (response) => {
            responseCount++;
            response.interceptorCount = responseCount;
            return response;
        }
    });

    const response1 = await api.get('/cacheable');
    strictEqual(response1.interceptorCount, 1, 'First response should be intercepted');

    const response2 = await api.get('/cacheable');

    ok(response2.fromCache, 'Should be from cache');
    // Note: Cached responses may or may not go through interceptors depending on implementation

    delete global.fetch;
}

// Main test runner
async function runInterceptorTests() {
    console.log('🔄 Interceptor Tests\n');

    const startTime = Date.now();

    try {
        await test('basic request interceptor', testRequestInterceptor);
        await test('basic response interceptor', testResponseInterceptor);
        await test('error interceptor with re-throw', testErrorInterceptorRethrow);
        await test('silent error interceptor', testSilentErrorInterceptor);
        await test('request interceptor throws error', testRequestInterceptorThrows);
        await test('response interceptor throws error', testResponseInterceptorThrows);
        await test('multiple interceptors order', testMultipleInterceptorsOrder);
        await test('error interceptor chain', testErrorInterceptorChain);
        await test('async interceptors', testAsyncInterceptors);
        await test('async interceptor errors', testAsyncInterceptorErrors);
        await test('error type preservation', testErrorTypePreservation);
        await test('request config modification', testRequestConfigModification);
        await test('interceptor cache interaction', testInterceptorCacheInteraction);

        const duration = Date.now() - startTime;
        console.log(`\n✅ All interceptor tests passed (${duration}ms)`);

    } catch (error) {
        console.error('❌ Interceptor test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

process.on('exit', () => {
    if (global.fetch) delete global.fetch;
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
    runInterceptorTests();
}

export { runInterceptorTests };
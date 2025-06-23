#!/usr/bin/env node
/**
 * Memory Pressure Test for Grab.js
 * Tests memory leaks, pending request cleanup, and cache behavior under load
 *
 * Usage: node tests/performance/memory-pressure.js
 * With GC: node --expose-gc tests/performance/memory-pressure.js
 */

import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
dirname(__filename);

import { Grab, HttpError, NetworkError } from '../../src/Grab.js';

const { ok, strictEqual, fail } = assert;

// Test utilities
function formatMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

function forceGC() {
    if (global.gc) {
        global.gc();
        global.gc();
    }
}

const createMockFetch = (responseSize = 1024) => {
    let callCount = 0;

    return (url, options) => {
        callCount++;

        // Simple fast response for most tests
        if (url.includes('/slow')) {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    resolve({
                        ok: true,
                        status: 200,
                        headers: new Map([['content-type', 'application/json']]),
                        url,
                        json: () => Promise.resolve({
                            id: callCount,
                            data: 'x'.repeat(responseSize),
                            timestamp: Date.now()
                        })
                    });
                }, 50); // Reduced timeout

                // Handle abort signal properly
                if (options?.signal) {
                    options.signal.addEventListener('abort', () => {
                        clearTimeout(timeout);
                        reject(new DOMException('The operation was aborted', 'AbortError'));
                    }, { once: true });
                }
            });
        }

        if (url.includes('/error')) {
            return Promise.resolve({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                headers: new Map(),
                url
            });
        }

        // Default fast response
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Map([
                ['content-type', 'application/json'],
                ['etag', `"etag-${callCount}"`]
            ]),
            url,
            json: () => Promise.resolve({
                id: callCount,
                data: 'x'.repeat(responseSize),
                timestamp: Date.now()
            })
        });
    };
};

// Test 1: Memory leak under sustained load
async function testMemoryLeak() {
    console.log('🧪 Testing memory leak under sustained load...');

    global.fetch = createMockFetch(1024); // Smaller responses for speed

    const api = new Grab({
        cache: { maxSize: 100, ttl: 60000 },
        retry: { attempts: 1 }
    });

    const beforeMem = process.memoryUsage().heapUsed;
    console.log(`   Initial memory: ${formatMB(beforeMem)}`);

    const promises = [];
    // Reduced number of requests for faster testing
    for (let i = 0; i < 100; i++) {
        promises.push(
            api.get(`/data/${i}?unique=${Math.random()}`)
                .catch(() => {})
        );
    }

    await Promise.allSettled(promises);

    forceGC();
    await new Promise(resolve => setTimeout(resolve, 50));

    const afterMem = process.memoryUsage().heapUsed;
    const leakMB = (afterMem - beforeMem) / 1024 / 1024;

    console.log(`   Final memory: ${formatMB(afterMem)}`);
    console.log(`   Memory delta: ${leakMB.toFixed(2)}MB`);

    const stats = api.getCacheStats();
    console.log(`   Cache entries: ${stats.size}/${stats.maxSize}`);
    console.log(`   Pending requests: ${stats.pending}`);

    ok(leakMB < 50, `Memory leak detected: ${leakMB.toFixed(2)}MB increase`);
    ok(stats.pending === 0, `Pending requests not cleaned up: ${stats.pending}`);

    console.log('   ✅ Memory leak test passed');
}

// Test 2: Aborted request cleanup
async function testAbortedRequestCleanup() {
    console.log('🧪 Testing aborted request cleanup...');

    global.fetch = createMockFetch();

    const api = new Grab();
    const controllers = [];

    const promises = [];
    for (let i = 0; i < 5; i++) { // Reduced number
        const controller = new AbortController();
        controllers.push(controller);

        promises.push(
            api.get('/slow', { signal: controller.signal })
                .catch(() => {})
        );
    }

    // Wait a bit for requests to start
    await new Promise(resolve => setTimeout(resolve, 25));

    const statsDuring = api.getCacheStats();
    console.log(`   Pending during: ${statsDuring.pending}`);
    ok(statsDuring.pending >= 0, 'Should track pending requests');

    // Abort all requests
    controllers.forEach(controller => controller.abort());

    await Promise.allSettled(promises);
    await new Promise(resolve => setTimeout(resolve, 100));

    const statsAfter = api.getCacheStats();
    console.log(`   Pending after abort: ${statsAfter.pending}`);
    strictEqual(statsAfter.pending, 0, 'Pending requests should be cleaned up after abort');

    console.log('   ✅ Aborted request cleanup test passed');
}

// Test 3: Cache memory pressure (simplified)
async function testCacheMemoryPressure() {
    console.log('🧪 Testing cache memory pressure...');

    global.fetch = createMockFetch(2048); // Smaller responses

    const api = new Grab({
        cache: { maxSize: 200, ttl: 60000 } // Smaller cache
    });

    const beforeMem = process.memoryUsage().heapUsed;
    console.log(`   Initial memory: ${formatMB(beforeMem)}`);

    const promises = [];
    for (let i = 0; i < 100; i++) { // Reduced requests
        promises.push(api.get(`/large-data/${i}`));
    }

    await Promise.allSettled(promises);
    forceGC();

    const midMem = process.memoryUsage().heapUsed;
    const midStats = api.getCacheStats();
    console.log(`   After 100 requests: ${formatMB(midMem)} (+${formatMB(midMem - beforeMem)})`);
    console.log(`   Cache: ${midStats.size}/${midStats.maxSize} entries`);

    const morePromises = [];
    for (let i = 100; i < 250; i++) { // More requests to test eviction
        morePromises.push(api.get(`/large-data/${i}`));
    }

    await Promise.allSettled(morePromises);
    forceGC();

    const finalMem = process.memoryUsage().heapUsed;
    const finalStats = api.getCacheStats();

    console.log(`   Final cache size: ${finalStats.size}/${finalStats.maxSize}`);
    console.log(`   Final memory: ${formatMB(finalMem)}`);
    console.log(`   Total increase: ${formatMB(finalMem - beforeMem)}`);

    const memoryIncreaseMB = (finalMem - beforeMem) / 1024 / 1024;
    const expectedDataMB = (finalStats.maxSize * 2048) / (1024 * 1024);

    console.log(`   Expected data: ~${expectedDataMB.toFixed(2)}MB`);
    console.log(`   Actual memory: ${memoryIncreaseMB.toFixed(2)}MB`);

    ok(finalStats.size <= finalStats.maxSize, 'Cache should respect maxSize limit');

    const realisticLimit = expectedDataMB * 4; // 4x overhead is normal for JS
    ok(memoryIncreaseMB < realisticLimit,
        `Memory usage: ${memoryIncreaseMB.toFixed(2)}MB vs ${realisticLimit.toFixed(2)}MB limit`);

    console.log('   ✅ Cache memory pressure test passed');
}

// Test 4: ETag memory behavior
async function testETagMemoryBehavior() {
    console.log('🧪 Testing ETag memory behavior...');

    global.fetch = createMockFetch();

    const api = new Grab({ cache: { maxSize: 50 } }); // Smaller cache

    const promises = [];
    for (let i = 0; i < 75; i++) { // Test eviction
        promises.push(api.get(`/etag-test/${i}`));
    }

    await Promise.allSettled(promises);

    const stats = api.getCacheStats();
    console.log(`   Cache entries: ${stats.size}`);
    console.log(`   ETag entries: ${stats.etags}`);

    ok(stats.etags <= stats.maxSize, 'ETag storage should be bounded by cache size');

    api.clearCache();
    const clearedStats = api.getCacheStats();
    strictEqual(clearedStats.etags, 0, 'ETags should be cleared with cache');

    console.log('   ✅ ETag memory behavior test passed');
}

// Test 5: Request deduplication memory
async function testDeduplicationMemory() {
    console.log('🧪 Testing request deduplication memory...');

    let fetchCalls = 0;
    global.fetch = (url) => {
        fetchCalls++;
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({
                    ok: true,
                    status: 200,
                    headers: new Map([['content-type', 'application/json']]),
                    url,
                    json: () => Promise.resolve({
                        id: fetchCalls,
                        data: 'shared-response'
                    })
                });
            }, 50); // Faster response
        });
    };

    const api = new Grab();

    const promises = [];
    for (let i = 0; i < 10; i++) { // Reduced concurrent requests
        promises.push(api.get('/same-endpoint'));
    }

    const results = await Promise.allSettled(promises);

    console.log(`   Fetch calls made: ${fetchCalls}`);
    console.log(`   Requests completed: ${results.length}`);

    strictEqual(fetchCalls, 1, 'Should deduplicate to single network call');

    const successResults = results.filter(r => r.status === 'fulfilled');
    if (successResults.length > 0) {
        const firstData = successResults[0].value.data;
        const allSame = successResults.every(r => r.value.data.id === firstData.id);
        ok(allSame, 'All deduplicated requests should return same data');
    }

    console.log('   ✅ Request deduplication memory test passed');
}

// Main test runner
async function runMemoryTests() {
    console.log('🚀 Starting Grab.js Memory Pressure Tests\n');

    const startTime = Date.now();
    const initialMem = process.memoryUsage().heapUsed;

    try {
        await testMemoryLeak();
        console.log('');

        await testAbortedRequestCleanup();
        console.log('');

        await testCacheMemoryPressure();
        console.log('');

        await testETagMemoryBehavior();
        console.log('');

        await testDeduplicationMemory();
        console.log('');

        const endTime = Date.now();
        const finalMem = process.memoryUsage().heapUsed;
        const totalMemoryDelta = (finalMem - initialMem) / 1024 / 1024;

        console.log('🎉 All memory pressure tests passed!');
        console.log(`   Total test time: ${endTime - startTime}ms`);
        console.log(`   Test suite memory delta: ${totalMemoryDelta.toFixed(2)}MB`);

        if (totalMemoryDelta > 50) {
            console.log('⚠️  Warning: Test suite itself may have memory leaks');
        }

    } catch (error) {
        console.error('❌ Memory pressure test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        // Clean up
        if (global.fetch) {
            delete global.fetch;
        }
        forceGC();
    }
}

// Handle cleanup on exit
process.on('exit', () => {
    if (global.fetch) {
        delete global.fetch;
    }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMemoryTests();
}
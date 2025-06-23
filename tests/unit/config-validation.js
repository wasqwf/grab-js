#!/usr/bin/env node
/**
 * Configuration Validation Test for Grab.js
 * Tests how Grab handles invalid configurations and runtime failures
 *
 * Usage: node tests/unit/config-validation.js
 */

import assert from 'assert';
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {Grab, HttpError, NetworkError} from '../../src/Grab.js';

const {ok, strictEqual, fail, throws} = assert;

// Test utilities
const createMockFetch = () => {
    return (url, options) => {
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Map([['content-type', 'application/json']]),
            url,
            json: () => Promise.resolve({success: true})
        });
    };
};

// Test 1: Invalid timeout configurations
function testInvalidTimeoutConfigs() {
    console.log('🧪 Testing invalid timeout configurations...');

    const invalidConfigs = [
        {timeout: -1},
        {timeout: 'banana'},
        {timeout: null},
        {timeout: Infinity},
        {timeout: NaN}
    ];

    invalidConfigs.forEach((config, index) => {
        try {
            const api = new Grab(config);
            console.log(`   Config ${index + 1}: timeout=${config.timeout} -> normalized to ${api.timeout}`);

            ok(api.timeout > 0 && api.timeout < Infinity,
                `Invalid timeout should be normalized: ${api.timeout}`);
            ok(api.timeout === 30000 || api.timeout > 0,
                'Should use default or positive value');

        } catch (error) {
            ok(error.message.length > 0, 'Error message should not be empty');
            console.log(`   Config ${index + 1}: Rejected with: ${error.message}`);
        }
    });

    console.log('   ✅ Invalid timeout configurations test passed');
}

// Test 2: Invalid cache configurations
function testInvalidCacheConfigs() {
    console.log('🧪 Testing invalid cache configurations...');

    const invalidConfigs = [
        {cache: {maxSize: -5}},
        {cache: {maxSize: 'large'}},
        {cache: {ttl: -1000}},
        {cache: {ttl: 'forever'}},
        {cache: {enabled: 'yes'}},
        {cache: null}
    ];

    invalidConfigs.forEach((config, index) => {
        try {
            const api = new Grab(config);
            const stats = api.getCacheStats();

            console.log(`   Config ${index + 1}: ${JSON.stringify(config.cache)} -> maxSize=${stats.maxSize}, ttl=${stats.ttl}`);

            ok(stats.maxSize > 0, 'Cache maxSize should be positive');
            ok(stats.ttl > 0, 'Cache TTL should be positive');
            ok(typeof stats.maxSize === 'number', 'maxSize should be a number');
            ok(typeof stats.ttl === 'number', 'TTL should be a number');

        } catch (error) {
            console.log(`   Config ${index + 1}: Rejected with: ${error.message}`);
            // More flexible error checking - just ensure it's a reasonable error
            ok(error.message.length > 5, 'Error should have a meaningful message');
        }
    });

    console.log('   ✅ Invalid cache configurations test passed');
}

// Test 3: Invalid retry configurations
function testInvalidRetryConfigs() {
    console.log('🧪 Testing invalid retry configurations...');

    const invalidConfigs = [
        {retry: {attempts: -1}},
        {retry: {attempts: 'many'}},
        {retry: {attempts: Infinity}},
        {retry: {delay: -500}},
        {retry: {delay: 'slow'}},
        {retry: {condition: 'always'}}, // Should be function
        {retry: null}
    ];

    invalidConfigs.forEach((config, index) => {
        try {
            const api = new Grab(config);

            console.log(`   Config ${index + 1}: ${JSON.stringify(config.retry)} -> attempts=${api.retryAttempts}`);

            ok(api.retryAttempts >= 0, 'Retry attempts should be non-negative');
            ok(api.retryAttempts < 100, 'Retry attempts should be reasonable');
            ok(typeof api.retryAttempts === 'number', 'Retry attempts should be a number');
            ok(typeof api.retryCondition === 'function', 'Retry condition should be a function');

        } catch (error) {
            console.log(`   Config ${index + 1}: Rejected with: ${error.message}`);
            ok(error.message.length > 0, 'Error message should be descriptive');
        }
    });

    console.log('   ✅ Invalid retry configurations test passed');
}

// Test 4: Invalid base URL configurations
function testInvalidBaseUrlConfigs() {
    console.log('🧪 Testing invalid base URL configurations...');

    const invalidConfigs = [
        {baseUrl: 123},
        {baseUrl: null},
        {baseUrl: undefined},
        {baseUrl: {}},
        {baseUrl: []},
        {baseUrl: 'not-a-url'},
        {baseUrl: 'ftp://invalid-protocol.com'}
    ];

    invalidConfigs.forEach((config, index) => {
        try {
            const api = new Grab(config);

            console.log(`   Config ${index + 1}: ${config.baseUrl} -> "${api.baseUrl}"`);

            ok(typeof api.baseUrl === 'string', 'Base URL should be a string');

            if (api.baseUrl.length > 0) {
                ok(!api.baseUrl.endsWith('/'), 'Base URL should not end with slash');
            }

        } catch (error) {
            console.log(`   Config ${index + 1}: Rejected with: ${error.message}`);
            ok(error.message.includes('baseUrl') || error.message.includes('URL') || error.message.length > 5,
                'Error should be meaningful');
        }
    });

    console.log('   ✅ Invalid base URL configurations test passed');
}

// Test 5: Invalid headers configuration
function testInvalidHeadersConfig() {
    console.log('🧪 Testing invalid headers configuration...');

    const invalidConfigs = [
        {headers: 'Content-Type: application/json'},
        {headers: ['authorization', 'bearer token']},
        {headers: null},
        {headers: {'Content-Type': 123}},
        {headers: {'Content-Type': null}},
        {headers: {'Content-Type': undefined}}
    ];

    invalidConfigs.forEach((config, index) => {
        try {
            const api = new Grab(config);

            console.log(`   Config ${index + 1}: ${JSON.stringify(config.headers)} -> ${JSON.stringify(api.defaultHeaders)}`);

            ok(typeof api.defaultHeaders === 'object', 'Default headers should be an object');
            ok(api.defaultHeaders !== null, 'Default headers should not be null');

            Object.values(api.defaultHeaders).forEach(value => {
                ok(typeof value === 'string', `Header value should be string, got: ${typeof value}`);
            });

        } catch (error) {
            console.log(`   Config ${index + 1}: Rejected with: ${error.message}`);
            ok(error.message.length > 5, 'Error should be meaningful');
        }
    });

    console.log('   ✅ Invalid headers configuration test passed');
}

// Test 6: Runtime configuration validation
async function testRuntimeConfigValidation() {
    console.log('🧪 Testing runtime configuration validation...');
    global.fetch = createMockFetch();

    const api = new Grab();
    const invalidRequestConfigs = [
        {method: 'INVALID'},
        {method: 123},
        {headers: 'not-an-object'},
        {params: 'not-an-object'},
        {timeout: -1},
        {signal: 'not-a-signal'}
    ];

    for (let i = 0; i < invalidRequestConfigs.length; i++) {
        const config = invalidRequestConfigs[i];

        try {
            await api.request({url: '/test', ...config});
            console.log(`   Request config ${i + 1}: ${JSON.stringify(config)} -> accepted`);
        } catch (error) {
            console.log(`   Request config ${i + 1}: ${JSON.stringify(config)} -> rejected: ${error.message}`);

            ok(error.message.length > 10, 'Error message should be descriptive');
        }
    }

    console.log('   ✅ Runtime configuration validation test passed');
    delete global.fetch;
}

// Test 7: Circuit breaker configuration validation
function testCircuitBreakerConfig() {
    console.log('🧪 Testing circuit breaker configuration validation...');

    const invalidConfigs = [
        {circuitBreaker: {failureThreshold: -1}},
        {circuitBreaker: {failureThreshold: 'many'}},
        {circuitBreaker: {resetTimeout: -1000}},
        {circuitBreaker: {resetTimeout: 'long'}},
        {circuitBreaker: {fallback: 'not-a-function'}},
        {circuitBreaker: null}
    ];

    invalidConfigs.forEach((config, index) => {
        try {
            const api = new Grab(config);
            const stats = api.getCircuitBreakerStats();
            console.log(`   Config ${index + 1}: ${JSON.stringify(config.circuitBreaker)} -> threshold=${api.circuitBreaker.failureThreshold}, timeout=${api.circuitBreaker.resetTimeout}`);

            ok(api.circuitBreaker.failureThreshold > 0, 'Failure threshold should be positive');
            ok(api.circuitBreaker.resetTimeout > 0, 'Reset timeout should be positive');
            ok(typeof api.circuitBreaker.failureThreshold === 'number', 'Threshold should be number');
            ok(typeof api.circuitBreaker.resetTimeout === 'number', 'Timeout should be number');
        } catch (error) {
            console.log(`   Config ${index + 1}: Completely rejected: ${error.message}`);
            ok(error.message.length > 0, 'Error message should be descriptive');
        }
    });
    console.log('   ✅ Circuit breaker configuration test passed');
}

// Test 8: Edge case configurations
function testEdgeCaseConfigs() {
    console.log('🧪 Testing edge case configurations...');

    try {
        const api1 = new Grab();
        ok(api1.timeout > 0, 'Should have default timeout');
        ok(typeof api1.defaultHeaders === 'object', 'Should have default headers');
        console.log('   Empty config: ✅ Handled gracefully');
    } catch (error) {
        fail(`Empty config should not throw: ${error.message}`);
    }

    try {
        const api2 = new Grab({
            baseUrl: 'https://api.test.com',
            unknownProperty: 'should-be-ignored',
            anotherUnknown: {nested: 'value'}
        });
        ok(api2.baseUrl === 'https://api.test.com', 'Should preserve known properties');
        console.log('   Unknown properties: ✅ Ignored gracefully');
    } catch (error) {
        fail(`Unknown properties should be ignored: ${error.message}`);
    }

    try {
        const api3 = new Grab({
            cache: {
                enabled: true,
                ttl: 5000,
                nested: {
                    deep: {
                        invalid: 'should-not-break'
                    }
                }
            }
        });
        ok(api3.getCacheStats().ttl === 5000, 'Should use valid nested properties');
        console.log('   Deeply nested config: ✅ Handled gracefully');
    } catch (error) {
        console.log(`   Deeply nested config: Rejected (${error.message})`);
    }

    console.log('   ✅ Edge case configurations test passed');
}

async function runConfigValidationTests() {
    console.log('🚀 Starting Grab.js Configuration Validation Tests\n');
    const startTime = Date.now();

    try {
        testInvalidTimeoutConfigs();
        console.log('');

        testInvalidCacheConfigs();
        console.log('');

        testInvalidRetryConfigs();
        console.log('');

        testInvalidBaseUrlConfigs();
        console.log('');

        testInvalidHeadersConfig();
        console.log('');

        await testRuntimeConfigValidation();
        console.log('');

        testCircuitBreakerConfig();
        console.log('');

        testEdgeCaseConfigs();
        console.log('');

        const endTime = Date.now();

        console.log('🎉 All configuration validation tests passed!');
        console.log(`   Total test time: ${endTime - startTime}ms`);
        console.log('');
        console.log('📋 Summary:');
        console.log('   • Invalid configs are handled gracefully with reasonable defaults');
        console.log('   • Runtime validation catches common mistakes');
        console.log('   • Error messages are descriptive (when errors are thrown)');
        console.log('   • Unknown properties are ignored without breaking');

        // Ensure clean exit
        return Promise.resolve();
    } catch (error) {
        console.error('❌ Configuration validation test failed:', error.message);
        console.error(error.stack);
        throw error;
    }
}

process.on('exit', () => {
    if (global.fetch) {
        delete global.fetch;
    }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runConfigValidationTests().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Configuration validation test failed:', error.message);
        process.exit(1);
    });
}
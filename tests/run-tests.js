#!/usr/bin/env node
'use strict';

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_SUITES = {
    http: {
        file: 'integration/test-http-errors.js',
        name: 'HTTP Error Tests',
        emoji: '🧪'
    },
    network: {
        file: 'integration/test-network-errors.js',
        name: 'Network Error Tests',
        emoji: '🌐'
    },
    timeout: {
        file: 'integration/test-timeout-errors.js',
        name: 'Timeout Error Tests',
        emoji: '⏱️'
    },
    interceptors: {
        file: 'integration/test-interceptors.js',
        name: 'Interceptor Tests',
        emoji: '🔄'
    },
    config: {
        file: 'unit/config-validation.js',
        name: 'Configuration Validation Tests',
        emoji: '⚙️'
    },
    memory: {
        file: 'performance/memory-pressure.js',
        name: 'Memory Pressure Tests',
        emoji: '🧠'
    }
};

/**
 * Run a single test suite
 * @param {string} suite - Suite name
 * @returns {Promise<boolean>} Success status
 */
function runTestSuite(suite) {
    return new Promise((resolve) => {
        const testInfo = TEST_SUITES[suite];
        if (!testInfo) {
            console.error(`❌ Unknown test suite: ${suite}`);
            resolve(false);
            return;
        }

        const testPath = join(__dirname, testInfo.file);

        console.log(`${testInfo.emoji} ${testInfo.name}`);
        console.log(`   Running: ${testInfo.file}`);

        const child = spawn('node', [testPath], {
            stdio: 'inherit',
            cwd: __dirname
        });

        child.on('close', (code) => {
            if (code === 0) {
                console.log(`   ✅ ${testInfo.name} passed\n`);
                resolve(true);
            } else {
                console.log(`   ❌ ${testInfo.name} failed (exit code: ${code})\n`);
                resolve(false);
            }
        });

        child.on('error', (error) => {
            console.error(`   💥 Failed to run ${testInfo.name}:`, error.message);
            resolve(false);
        });
    });
}

/**
 * Main test runner
 */
async function runTests() {
    const args = process.argv.slice(2);

    let suitesToRun;
    if (args.length === 0) {
        suitesToRun = Object.keys(TEST_SUITES);
        console.log('🚀 Running all Grab.js test suites\n');
    } else {
        suitesToRun = args.filter(arg => TEST_SUITES[arg]);
        const invalid = args.filter(arg => !TEST_SUITES[arg]);

        if (invalid.length > 0) {
            console.error(`❌ Unknown test suites: ${invalid.join(', ')}`);
            console.log('Available suites:', Object.keys(TEST_SUITES).join(', '));
            process.exit(1);
        }

        console.log(`🎯 Running selected test suites: ${suitesToRun.join(', ')}\n`);
    }

    const startTime = Date.now();
    const results = [];

    for (const suite of suitesToRun) {
        const success = await runTestSuite(suite);
        results.push({ suite, success });
    }

    const duration = Date.now() - startTime;
    const passed = results.filter(r => r.success).length;
    const total = results.length;

    console.log('📊 Test Summary');
    console.log('===============');

    results.forEach(({ suite, success }) => {
        const status = success ? '✅' : '❌';
        const name = TEST_SUITES[suite].name;
        console.log(`${status} ${name}`);
    });

    console.log(`\n${passed}/${total} test suites passed`);
    console.log(`Total time: ${Math.round(duration / 1000)}s`);

    if (passed === total) {
        console.log('\n🎉 All tests passed!');
        // Small delay to ensure all async operations complete
        setTimeout(() => process.exit(0), 100);
    } else {
        console.log('\n💥 Some tests failed');
        setTimeout(() => process.exit(1), 100);
    }
}

function showHelp() {
    console.log('Grab.js Test Runner');
    console.log('===================');
    console.log('');
    console.log('Usage:');
    console.log('  node run-tests.js              # Run all tests');
    console.log('  node run-tests.js [suites...]  # Run specific test suites');
    console.log('');
    console.log('Available test suites:');

    Object.entries(TEST_SUITES).forEach(([key, info]) => {
        console.log(`  ${key.padEnd(12)} ${info.emoji} ${info.name}`);
    });

    console.log('');
    console.log('Examples:');
    console.log('  node run-tests.js http network');
    console.log('  node run-tests.js timeout');
    console.log('  node run-tests.js interceptors config');
    console.log('  node run-tests.js memory        # Memory pressure tests');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
}

process.on('SIGINT', () => {
    console.log('\n\n⚠️  Tests interrupted by user');
    process.exit(130);
});

runTests().catch((error) => {
    console.error('💥 Test runner failed:', error.message);
    process.exit(1);
});
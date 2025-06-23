 // Common test utilities

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Test timeout after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
}

export async function expectError(fn, errorType) {
    try {
        await fn();
        throw new Error(`Expected ${errorType?.name || 'error'} but none was thrown`);
    } catch (error) {
        if (errorType && !(error instanceof errorType)) {
            throw new Error(`Expected ${errorType.name}, got ${error.constructor.name}: ${error.message}`);
        }
        return error; // Return the error for further inspection
    }
}

export function formatMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

export function forceGC() {
    if (global.gc) {
        global.gc();
        global.gc(); // Call twice for good measure
    }
}

export function randomString(length = 10) {
    return Math.random().toString(36).substring(2, length + 2);
}
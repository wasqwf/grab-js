/**
 * Grab.js
 *
 * HTTP client that just works. No build tools, no dependencies, no drama.
 * Drop it in your project and start grabbing data from APIs.
 *
 * Features: Smart retries, response caching, circuit breakers, ETags,
 * request deduplication, auth-aware cache, priority hints.
 *
 * @version 1.0.0
 * @author grab-dev
 * @license MIT
 *
 * @example
 * const api = new Grab({ baseUrl: 'https://api.example.com' });
 * const response = await api.get('/users/42');
 * console.log('User:', response.data);
 */

// Constants
const CIRCUIT_CLOSED = 'CLOSED';
const CIRCUIT_OPEN = 'OPEN';
const CIRCUIT_HALF_OPEN = 'HALF_OPEN';

const AUTH_HEADERS = ['authorization', 'x-api-key', 'cookie'];
const CACHE_SEP = '\x00';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_CACHE_TTL = 5 * 60 * 1000;
const MAX_BACKOFF = 30000;
const MAX_PUSH_HINTS = 1000;

/**
 * HTTP Cache with ETags and auth-aware keys
 * Prevents cache poisoning and supports conditional requests
 */
class HttpCache {
    constructor(options = {}) {
        this.cache = new Map();
        this.ttl = options.ttl || DEFAULT_CACHE_TTL;
        this.maxSize = options.maxSize || 100;
        this.authHeaders = options.authHeaders || AUTH_HEADERS;

        this.pending = new Map();
        this.etags = new Map();
        this._authCache = new Map();
        this._cleanupScheduled = false;
    }

    /**
     * Generate a cache key with auth awareness to prevent data leakage
     */
    key(method, url, params = {}, headers = {}) {
        const parts = [method, url];

        // Add params if present
        parts.push(Object.keys(params).length ? JSON.stringify(params) : '');

        // Cache auth header extraction for performance
        const headerKeys = Object.keys(headers).sort().join(',');
        let authStr = this._authCache.get(headerKeys);

        if (authStr === undefined) {
            const authHeaders = {};
            this.authHeaders.forEach(name => {
                const value = findHeader(headers, name);
                if (value) authHeaders[name] = value;
            });
            authStr = Object.keys(authHeaders).length ? JSON.stringify(authHeaders) : '';

            // Prevent auth cache from growing too large
            if (this._authCache.size > 100) {
                const firstKey = this._authCache.keys().next().value;
                this._authCache.delete(firstKey);
            }
            this._authCache.set(headerKeys, authStr);
        }

        parts.push(authStr);
        return parts.join(CACHE_SEP);
    }

    getPending(key) {
        return this.pending.get(key);
    }

    track(key, promise) {
        this.pending.set(key, promise);
        promise.finally(() => this.pending.delete(key));
    }

    set(key, data, customTtl = null, etag = null) {
        // LRU eviction
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            this.etags.delete(oldestKey);
        }

        const entry = {
            data,
            expires: Date.now() + (customTtl || this.ttl),
            etag
        };

        this.cache.set(key, entry);
        if (etag) this.etags.set(key, etag);

        this._scheduleCleanup();
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            this.etags.delete(key);
            return null;
        }

        // LRU: move to end
        this.cache.delete(key);
        this.cache.set(key, entry);

        return { ...entry.data, fromCache: true };
    }

    etag(key) {
        return this.etags.get(key);
    }

    refresh(key) {
        const entry = this.cache.get(key);
        if (entry) {
            entry.expires = Date.now() + this.ttl;
            this.cache.set(key, entry);
        }
    }

    clear() {
        this.cache.clear();
        this.pending.clear();
        this.etags.clear();
        this._authCache.clear();
    }

    invalidate(pattern) {
        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        let count = 0;

        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                this.etags.delete(key);
                count++;
            }
        }
        return count;
    }

    stats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            ttl: this.ttl,
            pending: this.pending.size,
            etags: this.etags.size,
        };
    }

    _scheduleCleanup() {
        if (this._cleanupScheduled) return;
        this._cleanupScheduled = true;

        setTimeout(() => {
            this._cleanupScheduled = false;
            this._cleanup();
        }, 60000);
    }

    _cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expires <= now) {
                this.cache.delete(key);
                this.etags.delete(key);
            }
        }
    }
}

/**
 * Circuit breaker - fail fast when services are down
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000;
        this.fallback = options.fallback;

        this.state = CIRCUIT_CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.successCount = 0;
        this.halfOpenRequestSent = false;
    }

    async call(fn) {
        if (this.state === CIRCUIT_OPEN) {
            if (this.shouldReset()) {
                this.state = CIRCUIT_HALF_OPEN;
                this.halfOpenRequestSent = false;
            } else {
                return this.fallback();
            }
        }

        if (this.state === CIRCUIT_HALF_OPEN) {
            if (this.halfOpenRequestSent) {
                return this.fallback();
            }
            this.halfOpenRequestSent = true;
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failureCount = 0;
        this.successCount++;
        if (this.state === CIRCUIT_HALF_OPEN) {
            this.state = CIRCUIT_CLOSED;
            this.halfOpenRequestSent = false;
        }
    }

    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.state = CIRCUIT_OPEN;
        }
    }

    shouldReset() {
        return Date.now() - this.lastFailureTime > this.resetTimeout;
    }

    fallback() {
        if (this.fallback) {
            return this.fallback();
        }
        throw new Error(`Circuit breaker is OPEN - service temporarily unavailable`);
    }

    reset() {
        this.state = CIRCUIT_CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.halfOpenRequestSent = false;
    }

    stats() {
        return {
            state: this.state,
            failures: this.failureCount,
            successes: this.successCount,
            isHealthy: this.state === CIRCUIT_CLOSED && this.failureCount < this.failureThreshold,
        };
    }
}

/**
 * Error classes - because knowing what went wrong matters
 */
class HttpError extends Error {
    constructor(message, status, url, response) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.url = url;
        this.response = response;
    }
}

class NetworkError extends Error {
    constructor(message, url) {
        super(message);
        this.name = 'NetworkError';
        this.url = url;
    }
}

class TimeoutError extends Error {
    constructor(url, timeout) {
        super(`Request timeout after ${timeout}ms: ${url}`);
        this.name = 'TimeoutError';
        this.url = url;
        this.timeout = timeout;
    }
}

/**
 * Grab - HTTP client
 *
 * A small HTTP client with a lot the features:
 * retries, caching, circuit breakers, ETags, request deduplication.
 */
class Grab {
    constructor(options = {}) {
        this.baseUrl = normalizeBaseUrl(options.baseUrl);
        this.timeout = normalizeTimeout(options.timeout);
        this.defaultHeaders = normalizeHeaders(options.headers);

        // Set up caching
        const cacheOpts = normalizeCache(options.cache);
        this.cache = new HttpCache(cacheOpts);

        // Set up retries
        const retryOpts = normalizeRetry(options.retry);
        this.retryAttempts = retryOpts.attempts;
        this.retryDelay = retryOpts.delay || this.defaultRetryDelay;
        this.retryCondition = retryOpts.condition || this.defaultRetryCondition.bind(this);
        this.respectRetryAfter = retryOpts.respectRetryAfter;

        // Set up circuit breaker
        const cbOpts = normalizeCircuitBreaker(options.circuitBreaker);
        this.circuitBreaker = new CircuitBreaker(cbOpts);

        // Interceptors
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        this.errorInterceptors = [];

        // Browser-only features
        this.pushHints = typeof document !== 'undefined' ? new Set() : null;

        // Size limits for safety
        this.maxRequestSize = options.maxRequestSize || 10 * 1024 * 1024; // 10MB
        this.maxResponseSize = options.maxResponseSize || 50 * 1024 * 1024; // 50MB
    }

    // ============================================================================
    // PUBLIC API - HTTP METHODS
    // ============================================================================

    /**
     * Makes an HTTP request
     */
    async request(config) {
        // Run request interceptors
        let processedConfig = { ...config };
        for (const interceptor of this.requestInterceptors) {
            processedConfig = await interceptor(processedConfig);
        }

        const method = processedConfig.method || 'GET';
        let response;

        // Use cache for GET requests
        if (method === 'GET' && processedConfig.cache !== false) {
            response = await this.cacheableRequest(processedConfig);
        } else {
            response = await this.executeRequest(processedConfig);
        }

        // Run response interceptors
        let processedResponse = response;
        for (const interceptor of this.responseInterceptors) {
            processedResponse = await interceptor(processedResponse);
        }

        return processedResponse;
    }

    async get(url, options = {}) {
        return this.request({ ...options, method: 'GET', url });
    }

    async post(url, options = {}) {
        return this.request({ ...options, method: 'POST', url });
    }

    async put(url, options = {}) {
        return this.request({ ...options, method: 'PUT', url });
    }

    async patch(url, options = {}) {
        return this.request({ ...options, method: 'PATCH', url });
    }

    async delete(url, options = {}) {
        return this.request({ ...options, method: 'DELETE', url });
    }

    async head(url, options = {}) {
        return this.request({ ...options, method: 'HEAD', url });
    }

    // ============================================================================
    // CONVENIENCE METHODS
    // ============================================================================

    async json(method, url, data, options = {}) {
        const response = await this.request({
            ...options,
            method,
            url,
            body: data,
            headers: { 'Content-Type': 'application/json', ...options.headers },
        });
        return response.data;
    }

    async form(method, url, data, options = {}) {
        let formData = data;
        if (!isFormData(data)) {
            formData = new FormData();
            Object.entries(data).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    formData.append(key, value);
                }
            });
        }

        const response = await this.request({
            ...options,
            method,
            url,
            body: formData,
            headers: { ...options.headers }, // Don't override FormData Content-Type
        });
        return response.data;
    }

    // ============================================================================
    // CONFIGURATION & MANAGEMENT
    // ============================================================================

    /**
     * Add interceptors for custom behavior
     */
    use(interceptors) {
        if (interceptors.request) this.requestInterceptors.push(interceptors.request);
        if (interceptors.response) this.responseInterceptors.push(interceptors.response);
        if (interceptors.error) this.errorInterceptors.push(interceptors.error);
    }

    /**
     * Create a new instance with merged options
     */
    create(options) {
        return new Grab({
            baseUrl: this.baseUrl,
            timeout: this.timeout,
            headers: this.defaultHeaders,
            cache: { ttl: this.cache.ttl, maxSize: this.cache.maxSize },
            retry: {
                attempts: this.retryAttempts,
                delay: this.retryDelay,
                condition: this.retryCondition,
                respectRetryAfter: this.respectRetryAfter,
            },
            circuitBreaker: {
                failureThreshold: this.circuitBreaker.failureThreshold,
                resetTimeout: this.circuitBreaker.resetTimeout,
                fallback: this.circuitBreaker.fallback,
            },
            maxRequestSize: this.maxRequestSize,
            maxResponseSize: this.maxResponseSize,
            ...options,
        });
    }

    // ============================================================================
    // CACHE MANAGEMENT
    // ============================================================================

    clearCache() {
        this.cache.clear();
    }

    invalidateCache(pattern) {
        return this.cache.invalidate(pattern);
    }

    getCacheStats() {
        return this.cache.stats();
    }

    // ============================================================================
    // CIRCUIT BREAKER MANAGEMENT
    // ============================================================================

    getCircuitBreakerStats() {
        return this.circuitBreaker.stats();
    }

    resetCircuitBreaker() {
        this.circuitBreaker.reset();
    }

    isHealthy() {
        return this.circuitBreaker.stats().isHealthy;
    }

    // ============================================================================
    // REQUEST EXECUTION PIPELINE
    // ============================================================================

    async cacheableRequest(config) {
        const url = this.resolveUrl(config.url);
        const cacheKey = this.cache.key('GET', url, config.params, config.headers);

        // Check for in-flight request
        const pendingRequest = this.cache.getPending(cacheKey);
        if (pendingRequest) {
            return pendingRequest;
        }

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Add ETag if there is one
        const etag = this.cache.etag(cacheKey);
        if (etag) {
            config.headers = { ...config.headers, 'If-None-Match': etag };
        }

        // Execute request
        const requestPromise = this.circuitBreaker.call(async () => {
            return this.executeWithRetry(config);
        }).then(response => {
            if (response.status === 304) {
                this.cache.refresh(cacheKey);
                const refreshed = this.cache.get(cacheKey);
                if (refreshed) return refreshed;
            }

            if (response.ok) {
                const etag = response.headers.get('etag');
                this.cache.set(cacheKey, response, null, etag);
            }

            return response;
        });

        this.cache.track(cacheKey, requestPromise);
        return requestPromise;
    }

    async executeRequest(config) {
        const response = await this.circuitBreaker.call(async () => {
            return this.executeWithRetry(config);
        });

        if (this.pushHints) {
            this.processPushHints(response);
        }

        return response;
    }

    async executeWithRetry(config) {
        let lastError;

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                return await this.executeHttpRequest(config);
            } catch (error) {
                lastError = error;

                const isFinalAttempt = attempt === this.retryAttempts;
                const shouldRetry = this.retryCondition(error);

                if (isFinalAttempt || !shouldRetry) {
                    const finalError = await callErrorInterceptors(this.errorInterceptors, error);
                    throw finalError;
                }

                let delay = typeof this.retryDelay === 'function'
                    ? this.retryDelay(attempt)
                    : this.retryDelay;

                // Respect Retry-After header for 429s
                if (this.respectRetryAfter && error instanceof HttpError && error.status === 429) {
                    const retryAfter = error.response?.headers?.get('retry-after');
                    if (retryAfter) {
                        const retryAfterMs = toInt(retryAfter, 0) * 1000;
                        if (retryAfterMs > 0) delay = Math.min(retryAfterMs, MAX_BACKOFF);
                    }
                }

                await sleep(delay);
            }
        }

        throw lastError;
    }

    async executeHttpRequest(config) {
        const url = this.buildUrl(this.resolveUrl(config.url), config.params);
        const options = this.buildFetchOptions(config);
        const timeout = config.timeout || this.timeout;

        const controller = new AbortController();
        const cleanup = this.setupTimeout(controller, timeout);

        // Chain external abort signal
        if (config.signal) {
            if (config.signal.aborted) {
                controller.abort();
            } else {
                config.signal.addEventListener('abort', () => controller.abort());
            }
        }

        options.signal = controller.signal;

        try {
            const response = await fetch(url, options);
            return await this.buildResponse(response, config.responseType || 'auto', url);
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new TimeoutError(url, timeout);
            }
            if (error instanceof HttpError) {
                throw error;
            }
            throw new NetworkError(error.message, url);
        } finally {
            cleanup();
        }
    }

    // ============================================================================
    // REQUEST/RESPONSE PROCESSING
    // ============================================================================

    buildFetchOptions(config) {
        const { method = 'GET', headers = {}, body, priority } = config;

        let finalBody = body;

        // Check request size limit
        if (body && this.maxRequestSize) {
            const size = typeof body === 'string' ? body.length :
                body instanceof ArrayBuffer ? body.byteLength :
                    body instanceof FormData ? 0 : // Can't easily check FormData size
                        JSON.stringify(body || '').length;

            if (size > this.maxRequestSize) {
                throw new Error(`Request body too large: ${size} bytes (max: ${this.maxRequestSize})`);
            }
        }

        // JSON stringify objects (but not FormData, File, Blob)
        if (body && isObject(body) && !isFormData(body) && !isFile(body) && !isBlob(body)) {
            try {
                finalBody = JSON.stringify(body);
            } catch (error) {
                throw new Error(`Failed to serialize request body: ${error.message}`);
            }
        }

        // Build fetch options
        const options = {
            method,
            body: finalBody,
            credentials: 'same-origin',
        };

        // Handle headers carefully - don't override FormData's Content-Type
        if (isFormData(finalBody)) {
            // Let browser set Content-Type with boundary for FormData
            const cleanHeaders = { ...this.defaultHeaders, ...headers };
            delete cleanHeaders['Content-Type'];
            delete cleanHeaders['content-type'];
            options.headers = cleanHeaders;
        } else {
            options.headers = { ...this.defaultHeaders, ...headers };
        }

        // Adds a priority hint if supported
        if (priority && supportsPriority()) {
            options.priority = priority;
        }

        return options;
    }

    async buildResponse(response, responseType, originalUrl) {
        // Handles 304 Not Modified
        if (response.status === 304) {
            return {
                ok: true,
                status: 304,
                statusText: 'Not Modified',
                headers: response.headers,
                url: response.url,
                data: null,
            };
        }

        if (!response.ok) {
            throw new HttpError(
                `HTTP ${response.status}: ${response.statusText}`,
                response.status,
                originalUrl,
                response
            );
        }

        const data = await parseResponse(response, responseType, this.maxResponseSize);

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            url: response.url,
            data,
            etag: response.headers.get('etag'),
        };
    }

    // ============================================================================
    // URL & UTILITY METHODS
    // ============================================================================

    resolveUrl(url) {
        if (/^https?:\/\//.test(url)) {
            return url;
        }

        // Handles edge cases
        if (url.startsWith('//')) {
            throw new Error('Protocol-relative URLs not allowed for security');
        }

        return this.baseUrl ? `${this.baseUrl}/${url.replace(/^\//, '')}` : url;
    }

    buildUrl(url, params) {
        if (!params || Object.keys(params).length === 0) {
            return url;
        }

        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                searchParams.append(key, String(value));
            }
        });

        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}${searchParams.toString()}`;
    }

    setupTimeout(controller, timeout) {
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return () => clearTimeout(timeoutId);
    }

    // ============================================================================
    // BROWSER-SPECIFIC FEATURES
    // ============================================================================

    processPushHints(response) {
        if (!this.pushHints) return;

        // Prevent unbounded growth
        if (this.pushHints.size > MAX_PUSH_HINTS) {
            this.pushHints.clear();
        }

        const linkHeader = response.headers.get('link');
        if (!linkHeader) return;

        const linkRegex = /<([^>]+)>;\s*rel=(?:preload|prefetch)/g;
        let match;

        while ((match = linkRegex.exec(linkHeader)) !== null) {
            const resourceUrl = match[1];

            if (!this.pushHints.has(resourceUrl)) {
                this.pushHints.add(resourceUrl);

                const link = document.createElement('link');
                link.rel = 'preload';
                link.href = this.resolveUrl(resourceUrl);
                link.as = guessResourceType(resourceUrl);

                document.head.appendChild(link);
            }
        }
    }

    // ============================================================================
    // DEFAULT BEHAVIORS
    // ============================================================================

    /**
     * Default retry delay with jitter
     */
    defaultRetryDelay(attempt) {
        const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF);
        const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1); // ±10%
        return Math.max(100, Math.floor(baseDelay + jitter)); // Minimum 100ms
    }

    /**
     * Default retry condition
     */
    defaultRetryCondition(error) {
        if (error instanceof NetworkError || error instanceof TimeoutError) {
            return true;
        }
        if (error instanceof HttpError) {
            return error.status >= 500 || error.status === 408 || error.status === 429;
        }
        return false;
    }
}

// Configuration normalization - compact and functional

const normalizeTimeout = (t) => {
    if (t == null) return DEFAULT_TIMEOUT;
    const n = isNum(t) ? t : toInt(t, DEFAULT_TIMEOUT);
    return n > 0 ? clamp(n, 100, 300000) : DEFAULT_TIMEOUT;
};

const normalizeCache = (c = {}) => ({
    enabled: c.enabled !== false,
    ttl: Math.max(1000, Math.min(86400000, +c.ttl || DEFAULT_CACHE_TTL)),
    maxSize: Math.max(1, Math.min(10000, +c.maxSize || 100))
});

const normalizeRetry = (r = {}) => ({
    attempts: r.attempts >= 0 ? clamp(toInt(r.attempts, 3), 0, 10) : 3,
    delay: typeof r.delay === 'function' ? r.delay :
        isNum(r.delay) && r.delay >= 0 ? r.delay : null,
    condition: typeof r.condition === 'function' ? r.condition : null,
    respectRetryAfter: r.respectRetryAfter !== false
});

const normalizeCircuitBreaker = (c = {}) => ({
    failureThreshold: Math.max(1, Math.min(100, +c.failureThreshold || 5)),
    resetTimeout: Math.max(1000, Math.min(3600000, +c.resetTimeout || 60000)),
    fallback: typeof c.fallback === 'function' ? c.fallback : null
});

const normalizeHeaders = (headers) => {
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        return { 'Content-Type': 'application/json' };
    }

    const clean = {};
    for (const [k, v] of Object.entries(headers)) {
        if (k && typeof k === 'string' && v != null) {
            clean[k] = String(v);
        }
    }

    return Object.keys(clean).length
        ? { 'Content-Type': 'application/json', ...clean }
        : { 'Content-Type': 'application/json' };
};

const normalizeBaseUrl = (url) => {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
        try { new URL(url); } catch { return ''; }
    }
    return url.replace(/\/$/, '');
};

// Error interceptor chain
const callErrorInterceptors = async (interceptors, error) => {
    let current = error;
    for (const fn of interceptors) {
        try {
            const result = await fn(current);
            if (result !== undefined) current = result;
        } catch (err) {
            current = err;
        }
    }
    return current;
};

// Utility functions

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

function findHeader(headers, name) {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName) {
            return value;
        }
    }
    return null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const isNum = (n) => typeof n === 'number' && isFinite(n);

function isObject(value) {
    return value !== null && typeof value === 'object' && value.constructor === Object;
}

function isFormData(value) {
    return value instanceof FormData;
}

function isFile(value) {
    return typeof File !== 'undefined' && value instanceof File;
}

function isBlob(value) {
    return typeof Blob !== 'undefined' && value instanceof Blob;
}

const toInt = (val, fallback) => {
    const n = parseInt(val, 10);
    return isNaN(n) ? fallback : n;
};

function supportsPriority() {
    return typeof Request !== 'undefined' &&
        Request.prototype &&
        ('priority' in Request.prototype || 'importance' in Request.prototype);
}

function guessResourceType(url) {
    if (url.endsWith('.js')) return 'script';
    if (url.endsWith('.css')) return 'style';
    if (url.match(/\.(jpg|jpeg|png|gif|webp)$/)) return 'image';
    if (url.endsWith('.woff2') || url.endsWith('.woff')) return 'font';
    return 'fetch';
}

/**
 * Parse response with size limits
 */
async function parseResponse(response, responseType, maxSize) {
    const contentType = response.headers.get('content-type') || '';

    // Checks response size if possible
    const contentLength = response.headers.get('content-length');
    if (contentLength && maxSize && +contentLength > maxSize) {
        throw new Error(`Response too large: ${contentLength} bytes (max: ${maxSize})`);
    }

    if (responseType === 'json' || (responseType === 'auto' && contentType.includes('application/json'))) {
        return await response.json();
    } else if (responseType === 'text' || (responseType === 'auto' && contentType.startsWith('text/'))) {
        return await response.text();
    } else if (responseType === 'blob') {
        return response.blob();
    } else if (responseType === 'arraybuffer') {
        return response.arrayBuffer();
    } else if (responseType === 'stream') {
        return response.body;
    } else {
        // Auto-detect
        try {
            return await response.json();
        } catch {
            return await response.text();
        }
    }
}

export { Grab, HttpError, NetworkError, TimeoutError };
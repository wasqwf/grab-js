# Grab.js - HTTP Client for Constrained Environments

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/devmrcarnes/grab.js.svg)](https://github.com/grab-dev/grab.js/releases)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/grab-js)](https://bundlephobia.com/package/grab-js)

Zero-dependency HTTP client with retries, caching, circuit breakers, and ETags. Single file, no build tools required.

**Size:** 18KB minified, 5KB gzipped

## Quick Start

```html
<script src="grab.min.js"></script>
<script>
    const api = new Grab({ baseUrl: 'https://api.example.com' });
    const response = await api.get('/users');
    console.log(response.data);
</script>
```

## Features

- **Smart Retries** with exponential backoff
- **Response Caching** with ETag support
- **Circuit Breaker** for fault tolerance
- **Request Deduplication** prevents duplicate in-flight requests
- **Auth-Aware Cache** prevents user data leakage
- **Priority Hints** for modern browsers
- **HTTP/2 Push** hint processing

## Configuration

```javascript
const api = new Grab({
    baseUrl: 'https://api.example.com',
    timeout: 30000,
    headers: { 'Authorization': 'Bearer token' },
    
    cache: {
        enabled: true,
        ttl: 5 * 60 * 1000,  // 5 minutes
        maxSize: 100
    },
    
    retry: {
        attempts: 3,
        delay: (attempt) => Math.min(1000 * Math.pow(2, attempt - 1), 30000),
        condition: (error) => error.status >= 500
    },
    
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeout: 60000,
        fallback: () => ({ error: 'Service unavailable' })
    }
});
```

## HTTP Methods

```javascript
// Basic requests
await api.get('/users');
await api.post('/users', { body: userData });
await api.put('/users/123', { body: updateData });
await api.delete('/users/123');

// Query parameters
await api.get('/search', { params: { q: 'javascript', page: 1 } });

// Custom headers
await api.post('/upload', { 
    body: formData,
    headers: { 'Content-Type': 'multipart/form-data' }
});

// Response types
await api.get('/data.json', { responseType: 'json' });
await api.get('/image.png', { responseType: 'blob' });

// Priority hints
await api.get('/critical', { priority: 'high' });
```

## Interceptors

```javascript
// Add auth to all requests
api.use({
    request: (config) => {
        config.headers.Authorization = `Bearer ${getToken()}`;
        return config;
    }
});

// Log responses
api.use({
    response: (response) => {
        console.log(`${response.status} ${response.url}`);
        return response;
    }
});

// Handle auth errors
api.use({
    error: (error) => {
        if (error.status === 401) {
            window.location.href = '/login';
        }
        throw error;
    }
});
```

## Error Handling

```javascript
try {
    const response = await api.get('/data');
} catch (error) {
    if (error instanceof HttpError) {
        console.error(`HTTP ${error.status}: ${error.message}`);
    } else if (error instanceof NetworkError) {
        console.error('Network issue:', error.message);
    } else if (error instanceof TimeoutError) {
        console.error(`Timeout after ${error.timeout}ms`);
    }
}
```

## Convenience Methods

```javascript
// JSON requests (auto-sets Content-Type)
const userData = await api.json('POST', '/users', {
    name: 'Bob',
    email: 'bob@example.com'
});

// Form data
const result = await api.form('POST', '/upload', {
    file: fileInput.files[0],
    description: 'My file'
});
```

## Cache Management

```javascript
// Check stats
console.log(api.getCacheStats());
// { size: 10, maxSize: 100, ttl: 300000, pending: 0, etags: 5 }

// Clear cache
api.clearCache();

// Invalidate specific entries
api.invalidateCache('/users.*');

// Disable caching per request
await api.get('/real-time', { cache: false });
```

## Circuit Breaker

```javascript
// Check health
console.log(api.isHealthy());

// Get stats
const stats = api.getCircuitBreakerStats();
// { state: 'CLOSED', failures: 0, successes: 42, isHealthy: true }

// Reset manually
api.resetCircuitBreaker();
```

## Browser Support

Requires modern browsers with `fetch()` support. For IE11, add polyfills:

```html
<script src="https://polyfill.io/v3/polyfill.min.js?features=fetch,AbortController"></script>
<script src="grab.min.js"></script>
```

## Node.js Usage

If using Node, requires Node.js 18+ (for built-in fetch) or add polyfill:

```javascript
// Node 18+
const { Grab } = require('./Grab.js');

// Older Node
global.fetch = require('node-fetch');
const { Grab } = require('./Grab.js');
```

## License

MIT—Do whatever you want with it.

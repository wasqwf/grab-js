# Grab.js Usage Guide

**HTTP client without build tools, dependencies, or drama.**

## The Five-Minute Setup

1. **Download**: `grab.min.js` (16KB)
2. **Include**: `<script src="grab.min.js"></script>`
3. **Use**: `const api = new Grab(); await api.get('/data');`

Done.

## Deployment

### Option 1: Direct Include
```html
<script src="grab.min.js"></script>
<script>const api = new Grab();</script>
```

### Option 2: ES6 Modules
```javascript
import { Grab } from './Grab.js';
const api = new Grab();
```

### Option 3: Node.js
```javascript
const { Grab } = require('./Grab.js'); // Node 18+
```

## Production Setup

**File sizes:**
- Development: `Grab.js` (36KB, readable)
- Production: `grab.min.js` (16KB, minified)
- Gzipped: ~5KB (automatic compression)

**Browser support:** Modern browsers + IE11 with polyfills

**Server config:** Enable gzip, set cache headers, use HTTP/2

## Configuration

### Basic
```javascript
const api = new Grab({
    baseUrl: 'https://api.example.com',
    timeout: 10000,
    headers: { 'Authorization': 'Bearer token' }
});
```

### Production
```javascript
const api = new Grab({
    baseUrl: 'https://api.prod.com',
    cache: { ttl: 600000, maxSize: 200 },
    retry: { attempts: 5, delay: (n) => 1000 * n },
    circuitBreaker: { failureThreshold: 10 }
});
```

## Common Patterns

**Auth:**
```javascript
api.use({
    request: (config) => {
        config.headers.Authorization = `Bearer ${getToken()}`;
        return config;
    }
});
```

**Error handling:**
```javascript
api.use({
    error: (error) => {
        if (error.status === 401) redirect('/login');
        throw error;
    }
});
```

**File uploads:**
```javascript
const formData = new FormData();
formData.append('file', file);
await api.form('POST', '/upload', formData);
```

## Debugging

```javascript
// Enable logging
api.use({
    request: (config) => console.log('→', config.method, config.url),
    response: (resp) => console.log('←', resp.status, resp.fromCache ? '(cached)' : '')
});

// Check health
console.log(api.isHealthy()); // true/false
console.log(api.getCacheStats()); // { size: 10, maxSize: 100, ... }
```

## Migration

**From Axios:**
```javascript
// Same API, just works faster
const response = await api.get('/users', { params: { page: 1 } });
console.log(response.data);
```

**From fetch:**
```javascript
// Before: verbose error handling, manual JSON parsing
// After: automatic parsing, retry logic, caching
const response = await api.get('/users');
```

## Troubleshooting

- **"Grab is not defined"** → Check script loading order
- **CORS errors** → Server configuration issue, not client
- **Cache not working** → Only works for GET requests
- **Circuit breaker open** → Check `failureThreshold` setting

Performance automatically optimizes through caching, deduplication, and ETags. Monitor with built-in stats.
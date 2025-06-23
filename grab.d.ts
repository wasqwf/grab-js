export interface HttpResponse<T = any> {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Headers;
    url: string;
    data: T;
    etag?: string;
    fromCache?: boolean;
}

export interface RequestConfig {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
    url?: string;
    params?: Record<string, string | number | boolean>;
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    signal?: AbortSignal;
    cache?: boolean;
    responseType?: 'json' | 'text' | 'blob' | 'arraybuffer' | 'stream' | 'auto';
    priority?: 'high' | 'low';
}

export interface CacheOptions {
    enabled?: boolean;
    ttl?: number;
    maxSize?: number;
    authHeaders?: string[];
}

export interface RetryOptions {
    attempts?: number;
    delay?: number | ((attempt: number) => number);
    condition?: (error: Error) => boolean;
    respectRetryAfter?: boolean;
}

export interface CircuitBreakerOptions {
    failureThreshold?: number;
    resetTimeout?: number;
    fallback?: () => any;
}

export interface ServiceOptions {
    baseUrl?: string;
    timeout?: number;
    headers?: Record<string, string>;
    cache?: CacheOptions;
    retry?: RetryOptions;
    circuitBreaker?: CircuitBreakerOptions;
    maxRequestSize?: number;
    maxResponseSize?: number;
}

export interface Interceptors {
    request?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
    response?: <T>(response: HttpResponse<T>) => HttpResponse<T> | Promise<HttpResponse<T>>;
    error?: (error: Error) => Error | Promise<Error> | never;
}

export interface CacheStats {
    size: number;
    maxSize: number;
    ttl: number;
    pending: number;
    etags: number;
}

export interface CircuitBreakerStats {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failures: number;
    successes: number;
    isHealthy: boolean;
}

export class HttpError extends Error {
    name: 'HttpError';
    status: number;
    url: string;
    response: Response;

    constructor(message: string, status: number, url: string, response: Response);
}

export class NetworkError extends Error {
    name: 'NetworkError';
    url: string;

    constructor(message: string, url: string);
}

export class TimeoutError extends Error {
    name: 'TimeoutError';
    url: string;
    timeout: number;

    constructor(url: string, timeout: number);
}

export class Grab {
    baseUrl: string;
    timeout: number;
    defaultHeaders: Record<string, string>;
    retryAttempts: number;
    retryDelay: number | ((attempt: number) => number);
    retryCondition: (error: Error) => boolean;
    respectRetryAfter: boolean;
    maxRequestSize: number;
    maxResponseSize: number;

    constructor(options?: ServiceOptions);

    // Core request method
    request<T = any>(config: RequestConfig): Promise<HttpResponse<T>>;

    // HTTP verb methods
    get<T = any>(url: string, options?: Omit<RequestConfig, 'method' | 'url'>): Promise<HttpResponse<T>>;
    post<T = any>(url: string, options?: Omit<RequestConfig, 'method' | 'url'>): Promise<HttpResponse<T>>;
    put<T = any>(url: string, options?: Omit<RequestConfig, 'method' | 'url'>): Promise<HttpResponse<T>>;
    patch<T = any>(url: string, options?: Omit<RequestConfig, 'method' | 'url'>): Promise<HttpResponse<T>>;
    delete<T = any>(url: string, options?: Omit<RequestConfig, 'method' | 'url'>): Promise<HttpResponse<T>>;
    head<T = any>(url: string, options?: Omit<RequestConfig, 'method' | 'url'>): Promise<HttpResponse<T>>;

    // Convenience methods
    json<T = any>(method: string, url: string, data?: any, options?: RequestConfig): Promise<T>;
    form<T = any>(method: string, url: string, data: FormData | Record<string, any>, options?: RequestConfig): Promise<T>;

    // Interceptors
    use(interceptors: Interceptors): void;

    // Cache management
    clearCache(): void;
    invalidateCache(pattern: string | RegExp): number;
    getCacheStats(): CacheStats;

    // Circuit breaker
    getCircuitBreakerStats(): CircuitBreakerStats;
    resetCircuitBreaker(): void;
    isHealthy(): boolean;

    // Instance creation
    create(options: ServiceOptions): Grab;

    // URL and request building utilities
    resolveUrl(url: string): string;
    buildUrl(url: string, params?: Record<string, any>): string;

    // Internal retry methods
    defaultRetryDelay(attempt: number): number;
    defaultRetryCondition(error: Error): boolean;
}

// Export as default for CommonJS compatibility
declare const _default: {
    Grab: typeof Grab;
    HttpError: typeof HttpError;
    NetworkError: typeof NetworkError;
    TimeoutError: typeof TimeoutError;
};

export default _default;
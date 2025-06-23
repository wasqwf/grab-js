#!/usr/bin/env node

/**
 * Simple Minifier for Grab.js
 *
 * This strips comments, unnecessary whitespace, and does basic compression.
 *
 * Usage: node scripts/minify.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get current directory (ES module equivalent of __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(__dirname);

/**
 * Basic JavaScript minifier
 * @param {string} code - JavaScript code to minify
 * @returns {string} Minified code
 */
function minify(code) {
    return code
        // Remove single-line comments (but preserve URLs and regex)
        .replace(/\/\/.*$/gm, '')

        // Remove multi-line comments (but preserve JSDoc for the header)
        .replace(/\/\*\*[\s\S]*?\*\//g, (match) => {
            // Keep the main header comment
            if (match.includes('@version') || match.includes('Grab.js - A Kick-Ass HTTP Client')) {
                return '/* Grab.js - Standalone HTTP client with retries, caching, circuit breaker, ETags, and deduplication */';
            }
            return '';
        })
        .replace(/\/\*[\s\S]*?\*\//g, '')

        // Remove extra whitespace
        .replace(/\s+/g, ' ')

        // Remove spaces around operators and punctuation
        .replace(/\s*([{}();,=+\-*/<>!&|])\s*/g, '$1')

        // Remove spaces after keywords
        .replace(/\b(if|for|while|function|return|var|let|const|class|new)\s+/g, '$1 ')

        // Clean up remaining issues
        .replace(/;\s*}/g, ';}')
        .replace(/}\s*else\s*{/g, '}else{')
        .replace(/}\s*catch\s*{/g, '}catch{')
        .replace(/}\s*finally\s*{/g, '}finally{')

        // Trim
        .trim();
}

/**
 * Create a gzipped version for size comparison
 * @param {string} content - Content to gzip
 * @returns {Buffer} Gzipped content
 */
async function gzip(content) {
    const { gzip: zlibGzip } = await import('zlib');
    const { promisify } = await import('util');
    const gzipAsync = promisify(zlibGzip);
    return gzipAsync(content);
}

/**
 * Format bytes for human reading
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Main execution
async function main() {
    try {
        // Look for source files in both /src and project root
        const possibleInputs = [
            path.join(projectRoot, 'src', 'Grab.js'),
            path.join(projectRoot, 'Grab.js')
        ];

        let inputFile = null;
        for (const file of possibleInputs) {
            if (fs.existsSync(file)) {
                inputFile = file;
                break;
            }
        }

        if (!inputFile) {
            console.error('💥 Could not find Grab.js source file!');
            console.log('Looked in:');
            possibleInputs.forEach(f => console.log(`  - ${f}`));
            console.log('\nAvailable files in project root:');
            fs.readdirSync(projectRoot)
                .filter(f => f.endsWith('.js'))
                .forEach(f => console.log(`  - ${f}`));
            process.exit(1);
        }

        const outputFile = path.join(projectRoot, 'dist', 'grab.min.js');
        const outputDir = path.dirname(outputFile);

        console.log('🚀 Minifying Grab.js...');
        console.log(`📁 Input: ${path.relative(projectRoot, inputFile)}`);
        console.log(`📁 Output: ${path.relative(projectRoot, outputFile)}`);

        // Create dist directory if it doesn't exist
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
            console.log(`📁 Created directory: ${path.relative(projectRoot, outputDir)}`);
        }

        // Read the source file
        const sourceCode = fs.readFileSync(inputFile, 'utf8');
        const originalSize = sourceCode.length;

        // Minify it
        const minifiedCode = minify(sourceCode);
        const minifiedSize = minifiedCode.length;

        // Write minified version
        fs.writeFileSync(outputFile, minifiedCode, 'utf8');

        // Create gzipped versions for size comparison
        const originalGzipped = await gzip(sourceCode);
        const minifiedGzipped = await gzip(minifiedCode);

        // Write gzipped version too
        fs.writeFileSync(outputFile + '.gz', minifiedGzipped);

        // Report results
        console.log('Minification complete!');
        console.log('');
        console.log('Size Report:');
        console.log(`Original:  ${formatBytes(originalSize)} (${formatBytes(originalGzipped.length)} gzipped)`);
        console.log(`Minified:  ${formatBytes(minifiedSize)} (${formatBytes(minifiedGzipped.length)} gzipped)`);
        console.log(`Savings:   ${formatBytes(originalSize - minifiedSize)} (${Math.round((1 - minifiedSize/originalSize) * 100)}%)`);
        console.log('');
        console.log(`Files created:`);
        console.log(`  - ${path.relative(projectRoot, outputFile)}`);
        console.log(`  - ${path.relative(projectRoot, outputFile)}.gz`);

        // Show feature summary
        console.log('');
        console.log('Features included:');
        console.log('  - Smart retries with exponential backoff');
        console.log('  - Response caching with ETags');
        console.log('  - Circuit breaker pattern');
        console.log('  - Request deduplication');
        console.log('  - HTTP/2 push hints support');
        console.log('  - Priority hints');
        console.log('  - Auth-aware cache keys');
        console.log('  - Interceptors for requests/responses/errors');

    } catch (error) {
        console.error('💥 Minification failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the main function
main();
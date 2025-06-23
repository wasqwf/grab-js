# Grab.js Makefile
# Test organization and build automation

.PHONY: help
help:
	@echo "Grab.js - Available targets:"
	@echo ""
	@echo "Testing:"
	@echo "  test           - Run all tests"
	@echo "  test-unit      - Run unit tests (fast)"
	@echo "  test-integration - Run integration tests"
	@echo "  test-performance - Run performance tests"
	@echo "  test-browser   - Run browser tests"
	@echo ""
	@echo "Development:"
	@echo "  build          - Build minified version"
	@echo "  demo           - Start demo server"
	@echo "  dev            - Start development server"
	@echo "  clean          - Remove build artifacts"

# Test categories
.PHONY: test-unit
test-unit:
	@echo "🧪 Running unit tests..."
	@for test in tests/unit/*-test.js; do \
		echo "  Running $$test"; \
		node "$$test" || exit 1; \
	done
	@echo "✅ Unit tests passed"

.PHONY: test-integration
test-integration:
	@echo "🔄 Running integration tests..."
	@for test in tests/integration/*-test.js; do \
		echo "  Running $$test"; \
		node "$$test" || exit 1; \
	done
	@echo "✅ Integration tests passed"

.PHONY: test-performance
test-performance:
	@echo "⚡ Running performance tests..."
	@for test in tests/performance/*-test.js; do \
		echo "  Running $$test"; \
		node --expose-gc "$$test" || exit 1; \
	done
	@echo "✅ Performance tests passed"

.PHONY: test-browser
test-browser:
	@echo "🌐 Browser tests require manual verification"
	@echo "  Start demo server: make demo"
	@echo "  Open: http://localhost:8080/tests/browser/browser-test.html"

# Run all tests
.PHONY: test
test: test-unit test-integration test-performance
	@echo "🎉 All tests passed!"

# Fast tests only (for development)
.PHONY: test-fast
test-fast: test-unit
	@echo "⚡ Fast tests completed"

# Legacy test support (backwards compatibility)
.PHONY: test-memory
test-memory:
	@echo "⚠️  Deprecated: use 'make test-performance' instead"
	node --expose-gc tests/performance/memory-pressure-test.js

.PHONY: test-config
test-config:
	@echo "⚠️  Deprecated: use 'make test-unit' instead"
	node tests/unit/config-validation-test.js

# Build targets
.PHONY: build
build:
	node scripts/minify.js
	@echo "📦 Built grab.min.js"

.PHONY: clean
clean:
	rm -rf dist/
	@echo "🧹 Cleaned build artifacts"

# Development servers
.PHONY: demo
demo:
	@echo "🚀 Demo server: http://localhost:8080"
	@echo "   Browser tests: http://localhost:8080/tests/browser/"
	python3 -m http.server 8080 || python -m http.server 8080

.PHONY: dev
dev:
	@echo "🔧 Dev server: http://localhost:8000"
	python3 -m http.server 8000 || python -m http.server 8000

# Development workflow
.PHONY: watch
watch:
	@echo "👀 Watching for changes..."
	@echo "  (Requires: brew install fswatch)"
	fswatch -o src/ tests/ | xargs -n1 -I{} make test-fast

# Validation and setup
.PHONY: check
check:
	@echo "🔍 Checking project structure..."
	@test -d tests/unit || (echo "❌ Missing tests/unit/" && exit 1)
	@test -d tests/integration || (echo "❌ Missing tests/integration/" && exit 1)
	@test -d tests/performance || (echo "❌ Missing tests/performance/" && exit 1)
	@test -f src/Grab.js || (echo "❌ Missing src/Grab.js" && exit 1)
	@echo "✅ Project structure valid"

# Setup new test structure
.PHONY: setup-tests
setup-tests:
	@echo "📁 Creating test directory structure..."
	mkdir -p tests/unit
	mkdir -p tests/integration
	mkdir -p tests/performance
	mkdir -p tests/browser
	mkdir -p tests/fixtures
	mkdir -p tests/helpers
	@echo "✅ Test directories created"
	@echo "💡 Now move your existing tests to the appropriate directories"
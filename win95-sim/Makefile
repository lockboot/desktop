# Use bash and source nvm for Node.js access
SHELL := /bin/bash
NVM_INIT := source ~/.nvm/nvm.sh 2>/dev/null || source ~/.bashrc 2>/dev/null || true

.PHONY: dev build test test-watch install clean typecheck

# Start development server
dev:
	@$(NVM_INIT) && npm run dev -- --host 0.0.0.0

# Build for production
build:
	@$(NVM_INIT) && npm run build

# Run tests once
test:
	@$(NVM_INIT) && npm test

# Run tests in watch mode
test-watch:
	@$(NVM_INIT) && npm run test:watch

# TypeScript type checking
typecheck:
	@$(NVM_INIT) && npx tsc --noEmit

# Install dependencies
install:
	@$(NVM_INIT) && npm install

preview:
	@$(NVM_INIT) && npm run preview

# Clean build artifacts
clean:
	rm -rf dist node_modules/.vite

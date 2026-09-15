// Stand-in for optional `@x402/*` dependencies aliased away in next.config.ts.
// CommonJS on purpose: its exports are not statically known to the bundler, so
// the named imports the Coinbase SDK makes resolve to undefined instead of
// failing the build. Nothing in this app ever calls them.
module.exports = new Proxy({}, { get: () => undefined });

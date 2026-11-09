// `build:vercel` runs these tests with production's variables. A paused app's
// MAINTENANCE_MODE would make Convex refuse every public mutation, so the tests
// start without it, and the ones that need it stub it.
delete process.env.MAINTENANCE_MODE;

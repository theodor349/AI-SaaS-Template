// True when this build was made with MAINTENANCE_MODE=1. The landing and legal pages
// stay up; sign-up, sign-in, payments, and every signed-in page show the maintenance
// notice instead. See docs/deployment.md#pausing-the-app.
export const maintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "1";

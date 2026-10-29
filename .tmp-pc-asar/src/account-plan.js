// Older profile responses inherit the authenticated account plan.
// Explicit STANDARD and unknown values must never be promoted to PREMIUM.
function resolveAccountType(profileType, accountType) {
  const value = profileType ?? accountType;
  return typeof value === 'string' && value.trim().toUpperCase() === 'PREMIUM' ? 'PREMIUM' : 'STANDARD';
}
if (typeof module !== 'undefined') module.exports = { resolveAccountType };
if (typeof window !== 'undefined') window.resolveAccountType = resolveAccountType;

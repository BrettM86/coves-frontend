/**
 * Generates a unique ID for form elements (labels, inputs, etc.).
 * Uses crypto.randomUUID() for collision-resistant IDs.
 */
export const generateID = (): string => {
  // crypto.randomUUID() is available in all modern browsers and Node.js 19+
  // It generates a RFC 4122 compliant UUID v4
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  // Fallback for environments without crypto.randomUUID (older Node.js)
  // Uses timestamp + high-entropy random string to minimize collision risk
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}

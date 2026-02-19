// ============================================================================
// Branded Types for Type-Safe ATProto String Identifiers
// ============================================================================

/**
 * Branded type for ATProto Decentralized Identifiers (DIDs).
 * Example: "did:plc:abc123" or "did:web:example.com"
 */
export type DID = string & { readonly __brand: 'DID' }

/**
 * Branded type for ATProto handles (usernames).
 * Example: "alice.bsky.social" or "bob.example.com"
 */
export type Handle = string & { readonly __brand: 'Handle' }

/**
 * Branded type for instance/server URLs.
 * Example: "https://bsky.social" or "https://coves.example.com"
 */
export type InstanceURL = string & { readonly __brand: 'InstanceURL' }

// ============================================================================
// Type Guards (Validators)
// ============================================================================

/**
 * Type guard to validate DID format and narrow type.
 * Validates DID format: did:{method}:{identifier} where method is lowercase letters
 * and identifier contains alphanumeric characters, dots, underscores, percent signs, or hyphens.
 *
 * @param value - The string to validate
 * @returns True if the value matches the DID format (also narrows type to DID)
 */
export function isValidDID(value: string): value is DID {
  return /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(value)
}

/**
 * Type guard to validate Handle format and narrow type.
 * Handles are domain-like identifiers (e.g., "user.domain.tld").
 * Must contain at least one dot with alphanumeric segments that may include hyphens.
 *
 * @param value - The string to validate
 * @returns True if the value matches the Handle format (also narrows type to Handle)
 */
export function isValidHandle(value: string): value is Handle {
  // Basic validation: at least one dot, alphanumeric with hyphens
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(
    value,
  )
}

/**
 * Type guard to validate Instance URL format and narrow type.
 * Must be a valid URL with http: or https: protocol.
 *
 * @param value - The string to validate
 * @returns True if the value is a valid http/https URL (also narrows type to InstanceURL)
 */
export function isValidInstanceURL(value: string): value is InstanceURL {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// ============================================================================
// Branded Type Constructors (Throwing)
// ============================================================================

/**
 * Creates a branded DID from a string.
 * @throws Error if the value is not a valid DID format
 */
export function asDID(value: string): DID {
  if (!isValidDID(value)) {
    throw new Error(`Invalid DID format: ${value}`)
  }
  return value as DID
}

/**
 * Creates a branded Handle from a string.
 * @throws Error if the value is not a valid Handle format
 */
export function asHandle(value: string): Handle {
  if (!isValidHandle(value)) {
    throw new Error(`Invalid Handle format: ${value}`)
  }
  return value as Handle
}

/**
 * Creates a branded InstanceURL from a string.
 * @throws Error if the value is not a valid URL
 */
export function asInstanceURL(value: string): InstanceURL {
  if (!isValidInstanceURL(value)) {
    throw new Error(`Invalid Instance URL format: ${value}`)
  }
  return value as InstanceURL
}

// ============================================================================
// Branded Type Constructors (Safe / Non-Throwing)
// ============================================================================

/**
 * Safely attempts to create a branded DID from a string.
 * @returns The branded DID or null if invalid
 */
export function tryAsDID(value: string): DID | null {
  return isValidDID(value) ? (value as DID) : null
}

/**
 * Safely attempts to create a branded Handle from a string.
 * @returns The branded Handle or null if invalid
 */
export function tryAsHandle(value: string): Handle | null {
  return isValidHandle(value) ? (value as Handle) : null
}

/**
 * Safely attempts to create a branded InstanceURL from a string.
 * @returns The branded InstanceURL or null if invalid
 */
export function tryAsInstanceURL(value: string): InstanceURL | null {
  return isValidInstanceURL(value) ? (value as InstanceURL) : null
}

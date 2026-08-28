/**
 * The local community domain, resolved once from public env — a leaf module.
 *
 * Kept apart from `./env` on purpose: that module fails fast in production
 * when the instance URL is missing, which is the right behaviour for the API
 * client but far too heavy a dependency for a link helper. Everything that
 * builds a community URL (`$lib/app/util/links`) reads this constant, so the
 * "is this community local?" decision has exactly one answer per deployment.
 *
 * See `localInstanceDomain` for the derivation and docs/ENVIRONMENT.md for
 * the operator-facing description of `PUBLIC_INSTANCE_DOMAIN`.
 */
import { env } from '$env/dynamic/public'
import { localInstanceDomain } from './resolve'

export const LOCAL_INSTANCE_DOMAIN: string | null = localInstanceDomain(env)

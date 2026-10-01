/**
 * Instance identity for link helpers, resolved once from public env — a leaf
 * module: the local community domain and this app's own web origin.
 *
 * Kept apart from `./env` on purpose: that module fails fast in production
 * when the instance URL is missing, which is the right behaviour for the API
 * client but far too heavy a dependency for a link helper. Everything that
 * builds a community URL (`$lib/app/util/links`) reads `LOCAL_INSTANCE_DOMAIN`,
 * so the "is this community local?" decision has exactly one answer per
 * deployment; markdown link localization reads `PUBLIC_INSTANCE_ORIGIN`.
 *
 * See `localInstanceDomain` for the derivation and docs/ENVIRONMENT.md for
 * the operator-facing description of `PUBLIC_INSTANCE_DOMAIN` and
 * `PUBLIC_INSTANCE_URL`.
 */
import { env } from '$env/dynamic/public'
import { instanceOrigin, localInstanceDomain } from './resolve'

export const LOCAL_INSTANCE_DOMAIN: string | null = localInstanceDomain(env)

/**
 * The origin (`scheme://host[:port]`) of `PUBLIC_INSTANCE_URL`; null when
 * unset or invalid. A markdown profile link opens in-app only when its origin
 * equals this one, so the frontend must be served on this origin (in
 * production, the same origin as `ORIGIN`) for links to its own profile pages
 * to open in-app. If the origins differ, those links keep their external href
 * and never open a different identity. Not `LOCAL_INSTANCE_DOMAIN`: that is
 * the community-origin domain, which can differ from the web host (in
 * development it does). Read once at module evaluation, like its neighbour.
 */
export const PUBLIC_INSTANCE_ORIGIN: string | null = instanceOrigin(
  env.PUBLIC_INSTANCE_URL,
)

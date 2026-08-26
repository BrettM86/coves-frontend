/**
 * A `$state`-backed box for a single value.
 *
 * Load functions cannot return runes directly, so route loaders wrap values
 * that components need to mutate reactively (e.g. a paginated list the page
 * appends to) in a `ReactiveState` instead.
 */
export class ReactiveState<T> {
  value: T = $state()!

  constructor(initialValue: T) {
    this.value = initialValue
  }
}

// XRPC transport layer for ATProto lexicon calls.

export class XrpcError extends Error {
  constructor(
    public status: number,
    public errorName: string,
    message: string,
  ) {
    super(message)
    this.name = 'XrpcError'
  }
}

interface XrpcClientOptions {
  fetchFn: typeof fetch
  baseUrl: string
}

export class XrpcClient {
  readonly #fetchFn: typeof fetch
  readonly #baseUrl: string

  constructor(options: XrpcClientOptions) {
    this.#fetchFn = options.fetchFn
    this.#baseUrl = options.baseUrl
  }

  async query<P, R>(nsid: string, params?: P): Promise<R> {
    const url = new URL(`/xrpc/${nsid}`, this.#baseUrl)

    if (params) {
      const searchParams = new URLSearchParams()
      for (const [key, value] of Object.entries(
        params as Record<string, unknown>,
      )) {
        if (value === undefined || value === null) continue
        searchParams.set(key, String(value))
      }
      url.search = searchParams.toString()
    }

    const res = await this.#fetchFn(url.toString())

    if (!res.ok) {
      throw await this.#parseError(res)
    }

    try {
      return (await res.json()) as R
    } catch {
      throw new XrpcError(
        res.status,
        'ParseError',
        'Failed to parse response as JSON',
      )
    }
  }

  async procedure<I, O>(nsid: string, input?: I): Promise<O> {
    const url = new URL(`/xrpc/${nsid}`, this.#baseUrl)

    const res = await this.#fetchFn(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: input !== undefined ? JSON.stringify(input) : undefined,
    })

    if (!res.ok) {
      throw await this.#parseError(res)
    }

    if (res.status === 204) {
      return undefined as O
    }

    const text = await res.text()
    if (!text) {
      return undefined as O
    }

    try {
      return JSON.parse(text) as O
    } catch {
      throw new XrpcError(
        res.status,
        'ParseError',
        'Failed to parse response as JSON',
      )
    }
  }

  async #parseError(res: Response): Promise<XrpcError> {
    try {
      const body = (await res.json()) as Record<string, unknown>
      const errorName =
        typeof body.error === 'string' ? body.error : 'UnknownError'
      const message =
        typeof body.message === 'string'
          ? body.message
          : `XRPC request failed with status ${res.status}`
      return new XrpcError(res.status, errorName, message)
    } catch {
      return new XrpcError(
        res.status,
        'UnknownError',
        `XRPC request failed with status ${res.status}`,
      )
    }
  }
}

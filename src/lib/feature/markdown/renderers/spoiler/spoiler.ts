import type { Lexer, Token } from 'marked'

/** Options parsed out of a container's opening fence. */
export type ContainerOptions = Record<string, string | true>

/** What the container tokenizer hands to its tokensExtractor. */
export interface ContainerParams {
  type: string
  content: string
  raw: string
  options: ContainerOptions
  lexer: Lexer
}

/**
 * The token an extractor returns. Deliberately minimal: the caller owns the
 * token's real shape (it is what the Svelte renderer for that type receives),
 * so this pins down only what marked requires plus the optional `tokens`
 * array the container fills with nested block tokens.
 *
 * `tokens` is marked's own `Token[]` rather than `unknown[]`: the array is
 * only ever filled by `this.lexer.blockTokens`, so stating the real element
 * type is what lets these extensions assign to marked's
 * `TokenizerAndRendererExtension` with no assertion at all.
 */
export interface ContainerToken {
  type: string
  raw: string
  tokens?: Token[]
}

export type ContainerTokensExtractor = (
  params: ContainerParams,
) => ContainerToken | undefined

/** marked's TokenizerExtension, narrowed to this extension's token type. */
export interface ContainerExtension {
  name: string
  level: 'block'
  start(src: string): number | undefined
  tokenizer(this: { lexer: Lexer }, src: string): ContainerToken | undefined
}

/**
 * Container extension is a marked extension that parses a block of text surrounded by :::
 *
 * @param tokensExtractor Converts the container input into a custom token that svelte components will receive.
 * If this function returns a value that contains an array of `tokens`,
 * this array will be populated with the tokens that are found inside the container,
 * allowing to nest markdown inside the container.
 *
 * @example
 *
 * Given the following markdown:
 *
 * :::container option="option-1" option-2="option-2" boolean-option
 * Something inside the container
 * :::
 *
 * The token extractor would receive the following parameters:
 * **type**: `container`
 * **content**: `Something inside the container`
 * **options**: { 'option': 'option-1', 'option-2': 'option-2', 'boolean-option': true }
 *
 * NOTE: the option names above are what this was designed to do, not what it
 * does — the name pattern excludes "-", so hyphenated names are split. See the
 * characterization tests in spoiler.test.ts for the behavior as it stands.
 */
export default function containerExtension(
  tokensExtractor: ContainerTokensExtractor,
): ContainerExtension {
  return {
    name: 'container',
    level: 'block',
    start(src) {
      return src.match(/:::[^:\n]/)?.index
    },
    tokenizer(src) {
      const rule =
        /:::[\s]?(?<type>[a-z0-9-]+)(?<options>.*)?\n(?<content>(?:.|\n)*)\n:::(?:\n)*/i

      // findRawContainer returns undefined only for input that does not open
      // with ":::", which the rule cannot match anyway.
      const match = rule.exec(findRawContainer(src) ?? '')
      if (!match || !match.groups) return undefined

      const type = match.groups.type.toLocaleLowerCase()
      const options = parseOptions(match.groups.options || '')
      const content = match.groups.content || ''

      const result = tokensExtractor({
        type: type,
        content: content,
        raw: match[0],
        options: options,
        lexer: this.lexer,
      })

      if (result?.tokens) {
        // Lex the container body and append it to the array the extractor
        // supplied. blockTokens() would fill that array in place if handed it
        // directly, but the array's element type belongs to the extractor's
        // token rather than to marked, so we take the return value instead of
        // asserting the array into marked's Token[].
        result.tokens.push(...this.lexer.blockTokens(content))
      }

      return result
    },
  }
}

function findRawContainer(src: string): string | undefined {
  if (!src.startsWith(':::')) return undefined
  const lines = src.split('\n')
  let open = 1
  let lineNumber = 1

  for (lineNumber = 1; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber]
    if (line.startsWith(':::')) {
      if (/:::[^:\n\s]/.test(line)) {
        open++
      } else if (/^:::(\n|$)/.test(line)) {
        open -= 1
      }
    }

    if (open === 0) {
      break
    }
  }

  return lines.slice(0, lineNumber + 1).join('\n')
}

function parseOptions(options: string): ContainerOptions {
  const output: ContainerOptions = {}
  let remaining = options

  while (true) {
    const regex = /(?<name>[a-z0-9]+)(?:="(?<value>(?:.*?))")?/i
    const match = regex.exec(remaining)
    if (!match) break

    const name = match?.groups?.name

    if (name) {
      output[name] = match?.groups?.value ?? true
    }

    remaining = remaining.slice(match.index + match[0].length)
  }

  return output
}

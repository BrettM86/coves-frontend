import { t } from '$lib/app/state/i18n'

export const placeholders = {
  get: (type: 'url' | 'post' | 'body' | 'comment'): string => {
    switch (type) {
      case 'post':
        return Math.random() < 0.01
          ? 'A C E C* B* G D E E F G F E D C E'
          : t.get('placeholders.title')
      case 'body':
        return t.get('placeholders.body')
      case 'comment':
        return t.get('placeholders.comments')
      case 'url':
        return 'https://example.com'
    }
  },
}

import { goto } from '$app/navigation'
import { page } from '$app/state'
import {
  profile as currentProfile,
  type ProfileInfo,
} from '$lib/app/state/auth.svelte'
import { t } from '$lib/app/state/i18n'
import { settings } from '$lib/app/state/settings.svelte'
import { TIMEFRAME_OPTIONS } from '$lib/api/coves/sort'
import { theme, type ThemeData } from '$lib/app/state/theme/theme.svelte'
import type { ResumableItem } from '$lib/feature/legacy/item.svelte'
import {
  type IconSource,
  ChartColumn,
  CircleUser,
  Clock,
  Columns3,
  Earth,
  Flame,
  Compass,
  House,
  LogIn,
  Monitor,
  Moon,
  Newspaper,
  Paintbrush,
  Settings,
  Sparkles,
  SquarePen,
  Star,
  Sun,
  SwatchBook,
  Trophy,
  Users,
} from '$lib/ui/kit/icon'
export interface Group {
  name: string
  actions: Action[]
}

export interface Action {
  name: string
  desc?: string
  handle?: () => void
  href?: string
  shortcut?: string
  icon: string | IconSource
  subActions?: Action[]
  detail?: string
}

export function getGroups(
  resumables: readonly ResumableItem[],
  profile: ProfileInfo,
  profiles: ProfileInfo[],
  td: ThemeData,
  contextual?: Action[],
): Group[] {
  return [
    {
      name: t.get('nav.commands.recents'),
      actions: resumables.map((r) => ({
        name: r.name,
        icon: r.avatar ?? SquarePen,
        href: r.url,
      })),
    },
    {
      name: t.get('nav.commands.contextual'),
      actions: contextual ?? [],
    },
    {
      name: t.get('nav.commands.main'),
      actions: [
        { href: '/', name: t.get('nav.home'), icon: House, shortcut: 'h' },
        {
          href: '/communities',
          name: t.get('nav.communities'),
          icon: Compass,
        },
      ],
    },
    {
      name: t.get('nav.commands.feeds'),
      actions: [
        {
          name: t.get('filter.feed.label'),
          icon: Earth,
          subActions: [
            {
              name: t.get('filter.feed.discover'),
              icon: Earth,
              href: '/?type=discover',
            },
            {
              name: t.get('filter.feed.forYou'),
              icon: Sparkles,
              href: '/?type=timeline',
            },
          ],
        },
        {
          name: t.get('filter.sort.label'),
          icon: ChartColumn,
          subActions: [
            {
              name: t.get('filter.sort.hot'),
              icon: Flame,
              href: '/?sort=hot',
            },
            {
              name: t.get('filter.sort.top.label'),
              icon: Trophy,
              subActions: TIMEFRAME_OPTIONS.map((timeframe) => ({
                name: t.get(timeframe.labelKey),
                icon: Clock,
                href: `/?sort=top&timeframe=${timeframe.value}`,
              })),
            },
            {
              name: t.get('filter.sort.new'),
              icon: Star,
              href: '/?sort=new',
            },
          ],
        },
      ],
    },
    {
      name: t.get('profile.profile'),
      actions:
        profile.type === 'authenticated'
          ? [
              {
                href: `/profile/${encodeURIComponent(profile.handle)}`,
                name: t.get('profile.profile'),
                icon: CircleUser,
              },
              {
                href: '/accounts',
                name: t.get('account.accounts'),
                icon: Users,
              },
              {
                href: '/login',
                name: t.get('account.login'),
                icon: LogIn,
              },
            ]
          : [
              {
                href: '/login',
                name: t.get('account.login'),
                icon: LogIn,
              },
              {
                href: '/accounts',
                name: t.get('account.accounts'),
                icon: Users,
              },
            ],
    },
    {
      name: t.get('account.accounts'),
      actions: profiles.map((p) => ({
        name: p.handle ?? t.get('account.guest'),
        icon: p.avatar ?? CircleUser,
        detail: p.instance,
        handle: async () => {
          if (profile.id != p.id) {
            currentProfile.meta.profile = p.id
          }

          await goto(page.url, {
            invalidateAll: true,
          })
        },
      })),
    },
    {
      name: t.get('nav.menu.app'),
      actions: [
        {
          href: '/settings',
          name: t.get('nav.menu.settings'),
          icon: Settings,
        },
        {
          name: t.get('nav.commands.setView'),
          icon: Columns3,
          subActions: [
            {
              name: t.get('nav.commands.setViewTo', {
                default: t.get('filter.view.compact'),
              }),
              icon: Columns3,
              handle: () => (settings.view = 'compact'),
            },
            {
              name: t.get('nav.commands.setViewTo', {
                default: t.get('filter.view.cozy'),
              }),
              icon: Columns3,
              handle: () => (settings.view = 'cozy'),
            },
          ],
        },
        {
          name: t.get('nav.commands.setColor'),
          icon: Paintbrush,
          subActions: [
            {
              name: t.get('nav.commands.setColorTo', {
                default: t.get('nav.menu.colorscheme.system'),
              }),
              handle: () => (theme.colorScheme = 'system'),
              icon: Monitor,
            },
            {
              name: t.get('nav.commands.setColorTo', {
                default: t.get('nav.menu.colorscheme.light'),
              }),
              handle: () => (theme.colorScheme = 'light'),
              icon: Sun,
            },
            {
              name: t.get('nav.commands.setColorTo', {
                default: t.get('nav.menu.colorscheme.dark'),
              }),
              handle: () => (theme.colorScheme = 'dark'),
              icon: Moon,
            },
          ],
        },
        {
          name: t.get('nav.commands.setTheme'),
          icon: SwatchBook,
          subActions: td.themes.map((th) => ({
            name: t.get('nav.commands.setThemeTo', { default: th.name }),
            icon: SwatchBook,
            handle: () => (theme.data.currentTheme = th.id),
          })),
        },
      ],
    },
    {
      name: t.get('nav.commands.content'),
      actions: [
        {
          href: '/create/post',
          name: t.get('form.post.create'),
          icon: SquarePen,
        },
      ],
    },
    // TODO: Re-enable subscriptions list when Coves API provides it
    {
      name: t.get('profile.subscribed'),
      actions: [],
    },
  ]
}

// this should really be rewritten, but a temporary change
// to make sure we don't recalculate ALL of that per keypress
export function dynamicActions(query: string): Group {
  const actions = [
    {
      name: t.get('nav.commands.communities', { default: query.trim() }),
      icon: Newspaper,
      href: `/explore/communities?q=${query}`,
    },
  ]

  return {
    name: t.get('routes.search.other'),
    actions: actions,
  }
}

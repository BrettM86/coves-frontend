import { describe, it, expect } from 'vitest'
import type {
  CommunityRef,
  ExternalEmbed,
  ImageEmbed,
  PostStats,
  PostView,
  PostViewerState,
  RecordEmbed,
  VideoEmbed,
} from '$lib/api/coves/types'
import type { AtUri, CID } from '$lib/api/coves/types'
import type { DID, Handle } from '$lib/types/atproto'
import {
  bestImageURL,
  computeVoteState,
  extractEmbedAlt,
  extractEmbedThumbnail,
  extractEmbedTitle,
  extractEmbedUrl,
  iframeType,
  isYoutubeLink,
  mediaType,
  optimizeImageURL,
  postLink,
} from './helpers'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const imageEmbed: ImageEmbed = {
  $type: 'social.coves.embed.images#view',
  images: [{ image: 'https://cdn.example.com/pic.jpg', alt: 'A photo' }],
}

const externalEmbed: ExternalEmbed = {
  $type: 'social.coves.embed.external#view',
  external: {
    uri: 'https://example.com/article',
    title: 'Example Article',
    thumb: 'https://cdn.example.com/thumb.jpg',
  },
}

const videoEmbed: VideoEmbed = {
  $type: 'social.coves.embed.video#view',
  video: 'https://cdn.example.com/video.mp4',
  thumbnail: 'https://cdn.example.com/video-thumb.jpg',
  alt: 'A video',
}

const recordEmbed: RecordEmbed = {
  $type: 'social.coves.embed.record#view',
  post: {
    uri: 'at://did:plc:abc/post/1' as AtUri,
    cid: 'bafyreig1' as CID,
  },
}

// ---------------------------------------------------------------------------
// mediaType()
// ---------------------------------------------------------------------------

describe('mediaType', () => {
  it('returns "none" for undefined embed', () => {
    expect(mediaType(undefined)).toBe('none')
  })

  it('returns "image" for image embed', () => {
    expect(mediaType(imageEmbed)).toBe('image')
  })

  it('returns "iframe" for video embed', () => {
    expect(mediaType(videoEmbed)).toBe('iframe')
  })

  it('returns "embed" for record embed', () => {
    expect(mediaType(recordEmbed)).toBe('embed')
  })

  it('returns "image" for external embed with image URI', () => {
    const embed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://example.com/photo.png' },
    }
    expect(mediaType(embed)).toBe('image')
  })

  it('returns "iframe" for external embed with video URI', () => {
    const embed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://example.com/clip.mp4' },
    }
    expect(mediaType(embed)).toBe('iframe')
  })

  it('returns "iframe" for external embed with YouTube URI', () => {
    const embed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    }
    expect(mediaType(embed)).toBe('iframe')
  })

  it('returns "embed" for external embed with generic URL', () => {
    const embed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://example.com/article' },
    }
    expect(mediaType(embed)).toBe('embed')
  })

  it('returns "none" for external embed with empty URI', () => {
    const embed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: '' },
    }
    expect(mediaType(embed)).toBe('none')
  })

  it('returns "none" for external embed with invalid URI', () => {
    const embed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'not a url' },
    }
    expect(mediaType(embed)).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// bestImageURL()
// ---------------------------------------------------------------------------

describe('bestImageURL', () => {
  it('returns empty string for undefined embed', () => {
    expect(bestImageURL(undefined)).toBe('')
  })

  it('returns image URL for image embed', () => {
    const result = bestImageURL(imageEmbed)
    expect(result).toBe('https://cdn.example.com/pic.jpg')
  })

  it('returns thumb by default when thumb field is present', () => {
    const embedWithThumb = {
      $type: 'social.coves.embed.images#view' as const,
      images: [
        {
          image: 'https://cdn.example.com/pic.jpg',
          thumb: 'https://cdn.example.com/pic-thumb.jpg',
          alt: 'A photo',
        },
      ],
    } satisfies import('$lib/api/coves/types').ImageEmbed
    // default variant (no 3rd arg) should use 'thumb'
    expect(bestImageURL(embedWithThumb)).toBe(
      'https://cdn.example.com/pic-thumb.jpg',
    )
  })

  it('returns thumb field when available for image embed', () => {
    const embedWithThumb: ImageEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://cdn.example.com/pic.jpg',
          thumb: 'https://cdn.example.com/pic-thumb.jpg',
          alt: 'A photo',
        },
      ],
    }
    expect(bestImageURL(embedWithThumb, true, 'thumb')).toBe(
      'https://cdn.example.com/pic-thumb.jpg',
    )
  })

  it('returns fullsize field when variant is fullsize', () => {
    const embedWithFullsize: ImageEmbed = {
      $type: 'social.coves.embed.images#view',
      images: [
        {
          image: 'https://cdn.example.com/pic.jpg',
          fullsize: 'https://cdn.example.com/pic-full.jpg',
          alt: 'A photo',
        },
      ],
    }
    expect(bestImageURL(embedWithFullsize, true, 'fullsize')).toBe(
      'https://cdn.example.com/pic-full.jpg',
    )
  })

  it('returns thumbnail for external embed when thumbnail=true', () => {
    const result = bestImageURL(externalEmbed, true)
    expect(result).toBe('https://cdn.example.com/thumb.jpg')
  })

  it('returns external URI when no thumb and thumbnail=false', () => {
    const noThumbEmbed: ExternalEmbed = {
      $type: 'social.coves.embed.external#view',
      external: { uri: 'https://example.com/article' },
    }
    const result = bestImageURL(noThumbEmbed, false)
    expect(result).toBe('https://example.com/article')
  })

  it('returns thumbnail for video embed', () => {
    const result = bestImageURL(videoEmbed)
    expect(result).toBe('https://cdn.example.com/video-thumb.jpg')
  })

  it('returns empty string for video embed with no thumbnail', () => {
    const noThumbVideo: VideoEmbed = {
      $type: 'social.coves.embed.video#view',
      video: 'https://cdn.example.com/video.mp4',
    }
    expect(bestImageURL(noThumbVideo)).toBe('')
  })

  it('returns empty string for record embed', () => {
    expect(bestImageURL(recordEmbed)).toBe('')
  })

  it('returns empty string for image embed with empty images (type-cast edge case)', () => {
    const emptyImages = {
      $type: 'social.coves.embed.images#view' as const,
      images: [] as unknown as [
        import('$lib/api/coves/types').EmbedImage,
        ...import('$lib/api/coves/types').EmbedImage[],
      ],
    }
    expect(bestImageURL(emptyImages)).toBe('')
  })

  it('returns external URI (not thumb) when thumbnail=false', () => {
    const result = bestImageURL(externalEmbed, false)
    expect(result).toBe('https://example.com/article')
  })
})

// ---------------------------------------------------------------------------
// optimizeImageURL()
// ---------------------------------------------------------------------------

describe('optimizeImageURL', () => {
  it('swaps preset in proxy URLs', () => {
    const result = optimizeImageURL(
      'https://cdn.example.com/img/content_preview/plain/did:plc:abc/bafyreig1',
      'content_full',
    )
    expect(result).toBe(
      'https://cdn.example.com/img/content_full/plain/did:plc:abc/bafyreig1',
    )
  })

  it('returns non-proxy URLs unchanged', () => {
    expect(optimizeImageURL('https://cdn.example.com/pic.jpg')).toBe(
      'https://cdn.example.com/pic.jpg',
    )
  })

  it('returns non-URL strings unchanged', () => {
    expect(optimizeImageURL('not-a-url')).toBe('not-a-url')
  })

  it('uses content_preview as default preset', () => {
    const proxyUrl =
      'https://cdn.example.com/img/avatar/plain/did:plc:abc/bafyreig1'
    const result = optimizeImageURL(proxyUrl)
    expect(result).toBe(
      'https://cdn.example.com/img/content_preview/plain/did:plc:abc/bafyreig1',
    )
  })
})

// ---------------------------------------------------------------------------
// isYoutubeLink()
// ---------------------------------------------------------------------------

describe('isYoutubeLink', () => {
  it('returns null for undefined', () => {
    expect(isYoutubeLink(undefined)).toBeNull()
  })

  it('matches standard YouTube watch URL', () => {
    expect(
      isYoutubeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    ).not.toBeNull()
  })

  it('matches youtu.be short URL', () => {
    expect(isYoutubeLink('https://youtu.be/dQw4w9WgXcQ')).not.toBeNull()
  })

  it('matches YouTube shorts URL', () => {
    expect(
      isYoutubeLink('https://youtube.com/shorts/dQw4w9WgXcQ'),
    ).not.toBeNull()
  })

  it('does not match non-YouTube URL', () => {
    expect(isYoutubeLink('https://example.com/video')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(isYoutubeLink('')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// iframeType()
// ---------------------------------------------------------------------------

describe('iframeType', () => {
  it('returns "video" for video URL', () => {
    expect(iframeType('https://example.com/clip.mp4')).toBe('video')
  })

  it('returns "youtube" for YouTube URL', () => {
    expect(iframeType('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'youtube',
    )
  })

  it('returns "none" for generic URL', () => {
    expect(iframeType('https://example.com/page')).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// extractEmbedUrl()
// ---------------------------------------------------------------------------

describe('extractEmbedUrl', () => {
  it('returns undefined for undefined embed', () => {
    expect(extractEmbedUrl(undefined)).toBeUndefined()
  })

  it('returns image URL for image embed', () => {
    expect(extractEmbedUrl(imageEmbed)).toBe('https://cdn.example.com/pic.jpg')
  })

  it('returns external URI for external embed', () => {
    expect(extractEmbedUrl(externalEmbed)).toBe('https://example.com/article')
  })

  it('returns video URL for video embed', () => {
    expect(extractEmbedUrl(videoEmbed)).toBe(
      'https://cdn.example.com/video.mp4',
    )
  })

  it('returns undefined for record embed', () => {
    expect(extractEmbedUrl(recordEmbed)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractEmbedThumbnail()
// ---------------------------------------------------------------------------

describe('extractEmbedThumbnail', () => {
  it('returns undefined for undefined embed', () => {
    expect(extractEmbedThumbnail(undefined)).toBeUndefined()
  })

  it('returns image URL for image embed (same as primary)', () => {
    expect(extractEmbedThumbnail(imageEmbed)).toBe(
      'https://cdn.example.com/pic.jpg',
    )
  })

  it('returns thumb for external embed', () => {
    expect(extractEmbedThumbnail(externalEmbed)).toBe(
      'https://cdn.example.com/thumb.jpg',
    )
  })

  it('returns thumbnail for video embed', () => {
    expect(extractEmbedThumbnail(videoEmbed)).toBe(
      'https://cdn.example.com/video-thumb.jpg',
    )
  })

  it('returns undefined for record embed', () => {
    expect(extractEmbedThumbnail(recordEmbed)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractEmbedTitle()
// ---------------------------------------------------------------------------

describe('extractEmbedTitle', () => {
  it('returns undefined for undefined embed', () => {
    expect(extractEmbedTitle(undefined)).toBeUndefined()
  })

  it('returns title for external embed', () => {
    expect(extractEmbedTitle(externalEmbed)).toBe('Example Article')
  })

  it('returns undefined for image embed', () => {
    expect(extractEmbedTitle(imageEmbed)).toBeUndefined()
  })

  it('returns undefined for video embed', () => {
    expect(extractEmbedTitle(videoEmbed)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// extractEmbedAlt()
// ---------------------------------------------------------------------------

describe('extractEmbedAlt', () => {
  it('returns undefined for undefined embed', () => {
    expect(extractEmbedAlt(undefined)).toBeUndefined()
  })

  it('returns alt for image embed', () => {
    expect(extractEmbedAlt(imageEmbed)).toBe('A photo')
  })

  it('returns alt for video embed', () => {
    expect(extractEmbedAlt(videoEmbed)).toBe('A video')
  })

  it('returns undefined for external embed', () => {
    expect(extractEmbedAlt(externalEmbed)).toBeUndefined()
  })

  it('returns undefined for record embed', () => {
    expect(extractEmbedAlt(recordEmbed)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// computeVoteState()
// ---------------------------------------------------------------------------

describe('computeVoteState', () => {
  const baseStats: PostStats = {
    upvotes: 10,
    downvotes: 2,
    score: 8,
    commentCount: 5,
  }
  const noVoteViewer: PostViewerState = { saved: false }

  it('upvote from no vote increments upvotes', () => {
    const result = computeVoteState(baseStats, noVoteViewer, 'up')
    expect(result.stats.upvotes).toBe(11)
    expect(result.stats.downvotes).toBe(2)
    expect(result.stats.score).toBe(9)
    expect(result.viewer.vote).toBe('up')
  })

  it('downvote from no vote increments downvotes', () => {
    const result = computeVoteState(baseStats, noVoteViewer, 'down')
    expect(result.stats.upvotes).toBe(10)
    expect(result.stats.downvotes).toBe(3)
    expect(result.stats.score).toBe(7)
    expect(result.viewer.vote).toBe('down')
  })

  it('toggling off upvote decrements upvotes', () => {
    const upViewer: PostViewerState = { saved: false, vote: 'up' }
    const result = computeVoteState(baseStats, upViewer, 'up')
    expect(result.stats.upvotes).toBe(9)
    expect(result.stats.downvotes).toBe(2)
    expect(result.stats.score).toBe(7)
    expect(result.viewer.vote).toBeUndefined()
  })

  it('toggling off downvote decrements downvotes', () => {
    const downViewer: PostViewerState = { saved: false, vote: 'down' }
    const result = computeVoteState(baseStats, downViewer, 'down')
    expect(result.stats.upvotes).toBe(10)
    expect(result.stats.downvotes).toBe(1)
    expect(result.stats.score).toBe(9)
    expect(result.viewer.vote).toBeUndefined()
  })

  it('switching from upvote to downvote', () => {
    const upViewer: PostViewerState = { saved: false, vote: 'up' }
    const result = computeVoteState(baseStats, upViewer, 'down')
    expect(result.stats.upvotes).toBe(9)
    expect(result.stats.downvotes).toBe(3)
    expect(result.stats.score).toBe(6)
    expect(result.viewer.vote).toBe('down')
  })

  it('switching from downvote to upvote', () => {
    const downViewer: PostViewerState = { saved: false, vote: 'down' }
    const result = computeVoteState(baseStats, downViewer, 'up')
    expect(result.stats.upvotes).toBe(11)
    expect(result.stats.downvotes).toBe(1)
    expect(result.stats.score).toBe(10)
    expect(result.viewer.vote).toBe('up')
  })

  it('handles undefined stats gracefully', () => {
    const result = computeVoteState(undefined, undefined, 'up')
    expect(result.stats.upvotes).toBe(1)
    expect(result.stats.downvotes).toBe(0)
    expect(result.stats.score).toBe(1)
    expect(result.viewer.vote).toBe('up')
  })

  it('does not mutate the original stats', () => {
    const originalStats = { ...baseStats }
    const originalViewer = { ...noVoteViewer }
    computeVoteState(originalStats, originalViewer, 'up')
    expect(originalStats.upvotes).toBe(10)
    expect(originalViewer.vote).toBeUndefined()
  })

  it('preserves saved state from viewer', () => {
    const savedViewer: PostViewerState = { saved: true }
    const result = computeVoteState(baseStats, savedViewer, 'up')
    expect(result.viewer.saved).toBe(true)
  })

  it('clears voteUri when toggling off a vote', () => {
    const upViewer: PostViewerState = {
      saved: false,
      vote: 'up',
      voteUri:
        'at://did:plc:abc/social.coves.community.vote/rkey1' as import('$lib/api/coves/types').AtUri,
    }
    const result = computeVoteState(baseStats, upViewer, 'up')
    expect(result.viewer.vote).toBeUndefined()
    expect(result.viewer.voteUri).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// postLink()
// ---------------------------------------------------------------------------

describe('postLink', () => {
  /**
   * Helper to build a minimal PostView fixture.
   * Only `uri`, `community.handle`, and `community.name` matter for postLink().
   */
  function makePostView(overrides: {
    uri: string
    communityHandle?: string
    communityName?: string
  }): PostView {
    const community: CommunityRef = {
      did: 'did:plc:community1' as DID,
      handle: (overrides.communityHandle ?? '') as Handle,
      name: overrides.communityName ?? 'fallback',
    }
    return {
      uri: overrides.uri as AtUri,
      cid: 'bafyreig1' as CID,
      rkey: '', // postLink derives rkey from the AT-URI, not this field
      indexedAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      author: {
        did: 'did:plc:author1' as DID,
        handle: 'alice.coves.social' as Handle,
      },
      community,
    }
  }

  it('strips c- prefix from community handle for the URL slug', () => {
    const post = makePostView({
      uri: 'at://did:plc:abc123/social.coves.community.post/rkey123',
      communityHandle: 'c-gaming.coves.social',
    })
    expect(postLink(post)).toBe('/c/gaming.coves.social/post/rkey123')
  })

  it('passes through community handle without c- prefix unchanged', () => {
    const post = makePostView({
      uri: 'at://did:plc:abc123/social.coves.community.post/rkey456',
      communityHandle: 'tech.coves.social',
    })
    expect(postLink(post)).toBe('/c/tech.coves.social/post/rkey456')
  })

  it('falls back to community.name when handle is empty', () => {
    const post = makePostView({
      uri: 'at://did:plc:abc123/social.coves.community.post/rkey789',
      communityHandle: '',
      communityName: 'general',
    })
    expect(postLink(post)).toBe('/c/general/post/rkey789')
  })

  it('falls back to community.name when handle is undefined', () => {
    const community: CommunityRef = {
      did: 'did:plc:community1' as DID,
      handle: undefined as unknown as Handle,
      name: 'announcements',
    }
    const post: PostView = {
      uri: 'at://did:plc:abc123/social.coves.community.post/rkeyabc' as AtUri,
      cid: 'bafyreig1' as CID,
      rkey: '',
      indexedAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      author: {
        did: 'did:plc:author1' as DID,
        handle: 'alice.coves.social' as Handle,
      },
      community,
    }
    expect(postLink(post)).toBe('/c/announcements/post/rkeyabc')
  })

  it('correctly parses the rkey from the AT-URI', () => {
    const post = makePostView({
      uri: 'at://did:plc:xyz/social.coves.community.post/3jui7kd2xs',
      communityHandle: 'tech.coves.social',
    })
    expect(postLink(post)).toBe('/c/tech.coves.social/post/3jui7kd2xs')
  })

  it('encodes special characters in the community slug', () => {
    const post = makePostView({
      uri: 'at://did:plc:abc123/social.coves.community.post/rkey1',
      communityHandle: 'c-my community.coves.social',
    })
    // communitySlug strips "c-" prefix -> "my community.coves.social"
    // encodeURIComponent encodes the space -> "my%20community.coves.social"
    expect(postLink(post)).toBe('/c/my%20community.coves.social/post/rkey1')
  })

  it('encodes special characters in the rkey', () => {
    const post = makePostView({
      uri: 'at://did:plc:abc123/social.coves.community.post/rkey+special',
      communityHandle: 'tech.coves.social',
    })
    // encodeURIComponent encodes "+" -> "%2B"
    expect(postLink(post)).toBe('/c/tech.coves.social/post/rkey%2Bspecial')
  })
})

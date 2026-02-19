import { describe, it, expect } from 'vitest'
import type {
  ExternalEmbed,
  ImageEmbed,
  PostEmbed,
  PostStats,
  PostViewerState,
  RecordEmbed,
  VideoEmbed,
} from '$lib/api/coves/types'
import type { AtUri, CID } from '$lib/api/coves/types'
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

  it('returns optimized URL for image embed', () => {
    const result = bestImageURL(imageEmbed)
    expect(result).toContain('cdn.example.com/pic.jpg')
    expect(result).toContain('format=webp')
  })

  it('returns thumbnail for external embed when thumbnail=true', () => {
    const result = bestImageURL(externalEmbed, true)
    expect(result).toContain('cdn.example.com/thumb.jpg')
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
    expect(result).toContain('cdn.example.com/video-thumb.jpg')
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
})

// ---------------------------------------------------------------------------
// optimizeImageURL()
// ---------------------------------------------------------------------------

describe('optimizeImageURL', () => {
  it('adds format and thumbnail params', () => {
    const result = optimizeImageURL(
      'https://cdn.example.com/pic.jpg',
      512,
      'webp',
    )
    expect(result).toContain('format=webp')
    expect(result).toContain('thumbnail=512')
  })

  it('returns original string for invalid URLs', () => {
    expect(optimizeImageURL('not-a-url')).toBe('not-a-url')
  })

  it('respects null format param', () => {
    const result = optimizeImageURL(
      'https://cdn.example.com/pic.jpg',
      256,
      null,
    )
    expect(result).not.toContain('format=')
  })

  it('does not overwrite existing thumbnail param', () => {
    const result = optimizeImageURL(
      'https://cdn.example.com/pic.jpg?thumbnail=128',
      1024,
    )
    expect(result).toContain('thumbnail=128')
    expect(result).not.toContain('thumbnail=1024')
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
})

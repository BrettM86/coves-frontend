import { XrpcClient } from './xrpc'
import type {
  AtUri,
  BlockCommunityInput,
  BlockUserInput,
  CommunityViewDetailed,
  CreateCommentInput,
  CreateCommentOutput,
  CreateCommunityInput,
  CreatePostInput,
  CreatePostOutput,
  CreateVoteInput,
  CreateVoteOutput,
  DeleteVoteInput,
  FeedResponse,
  GetActorCommentsParams,
  GetActorCommentsResponse,
  GetActorPostsParams,
  GetActorPostsResponse,
  GetCommentsParams,
  GetCommentsResponse,
  GetCommunityFeedParams,
  GetCommunityParams,
  GetPostParams,
  GetDiscoverParams,
  GetProfileParams,
  GetTimelineParams,
  ListCommunitiesParams,
  ListCommunitiesResponse,
  PostView,
  ProfileViewDetailed,
  SearchCommunitiesParams,
  SubscribeCommunityInput,
} from './types'

export const NSID = {
  getDiscover: 'social.coves.feed.getDiscover',
  getTimeline: 'social.coves.feed.getTimeline',
  getCommunityFeed: 'social.coves.communityFeed.getCommunity',
  getComments: 'social.coves.community.comment.getComments',
  createComment: 'social.coves.community.comment.create',
  deleteComment: 'social.coves.community.comment.delete',
  createVote: 'social.coves.feed.vote.create',
  deleteVote: 'social.coves.feed.vote.delete',
  getProfile: 'social.coves.actor.getProfile',
  getActorPosts: 'social.coves.actor.getPosts',
  getActorComments: 'social.coves.actor.getComments',
  blockUser: 'social.coves.actor.blockUser',
  unblockUser: 'social.coves.actor.unblockUser',
  getCommunity: 'social.coves.community.get',
  listCommunities: 'social.coves.community.list',
  searchCommunities: 'social.coves.community.search',
  createCommunity: 'social.coves.community.create',
  subscribe: 'social.coves.community.subscribe',
  unsubscribe: 'social.coves.community.unsubscribe',
  blockCommunity: 'social.coves.community.blockCommunity',
  unblockCommunity: 'social.coves.community.unblockCommunity',
  createPost: 'social.coves.community.post.create',
  deletePost: 'social.coves.community.post.delete',
  getPost: 'social.coves.community.post.get',
} as const

export class CovesClient {
  private xrpc: XrpcClient

  constructor(options: { fetchFn: typeof fetch; baseUrl: string }) {
    this.xrpc = new XrpcClient(options)
  }

  // Feed
  getDiscover(params?: GetDiscoverParams): Promise<FeedResponse> {
    return this.xrpc.query(NSID.getDiscover, params)
  }

  getTimeline(params?: GetTimelineParams): Promise<FeedResponse> {
    return this.xrpc.query(NSID.getTimeline, params)
  }

  getCommunityFeed(params: GetCommunityFeedParams): Promise<FeedResponse> {
    return this.xrpc.query(NSID.getCommunityFeed, params)
  }

  // Comments
  getComments(params: GetCommentsParams): Promise<GetCommentsResponse> {
    return this.xrpc.query(NSID.getComments, params)
  }

  createComment(input: CreateCommentInput): Promise<CreateCommentOutput> {
    return this.xrpc.procedure(NSID.createComment, input)
  }

  deleteComment(input: { uri: AtUri }): Promise<void> {
    return this.xrpc.procedure(NSID.deleteComment, input)
  }

  // Votes
  createVote(input: CreateVoteInput): Promise<CreateVoteOutput> {
    return this.xrpc.procedure(NSID.createVote, input)
  }

  deleteVote(input: DeleteVoteInput): Promise<void> {
    return this.xrpc.procedure(NSID.deleteVote, input)
  }

  // Actor
  getProfile(params: GetProfileParams): Promise<ProfileViewDetailed> {
    return this.xrpc.query(NSID.getProfile, params)
  }

  getActorPosts(params: GetActorPostsParams): Promise<GetActorPostsResponse> {
    return this.xrpc.query(NSID.getActorPosts, params)
  }

  getActorComments(
    params: GetActorCommentsParams,
  ): Promise<GetActorCommentsResponse> {
    return this.xrpc.query(NSID.getActorComments, params)
  }

  blockUser(input: BlockUserInput): Promise<void> {
    return this.xrpc.procedure(NSID.blockUser, input)
  }

  unblockUser(input: BlockUserInput): Promise<void> {
    return this.xrpc.procedure(NSID.unblockUser, input)
  }

  // Community
  getCommunity(params: GetCommunityParams): Promise<CommunityViewDetailed> {
    return this.xrpc.query(NSID.getCommunity, params)
  }

  listCommunities(
    params?: ListCommunitiesParams,
  ): Promise<ListCommunitiesResponse> {
    return this.xrpc.query(NSID.listCommunities, params)
  }

  searchCommunities(
    params: SearchCommunitiesParams,
  ): Promise<ListCommunitiesResponse> {
    return this.xrpc.query(NSID.searchCommunities, params)
  }

  createCommunity(input: CreateCommunityInput): Promise<CommunityViewDetailed> {
    return this.xrpc.procedure(NSID.createCommunity, input)
  }

  subscribe(input: SubscribeCommunityInput): Promise<void> {
    return this.xrpc.procedure(NSID.subscribe, input)
  }

  unsubscribe(input: SubscribeCommunityInput): Promise<void> {
    return this.xrpc.procedure(NSID.unsubscribe, input)
  }

  blockCommunity(input: BlockCommunityInput): Promise<void> {
    return this.xrpc.procedure(NSID.blockCommunity, input)
  }

  unblockCommunity(input: BlockCommunityInput): Promise<void> {
    return this.xrpc.procedure(NSID.unblockCommunity, input)
  }

  // Posts
  createPost(input: CreatePostInput): Promise<CreatePostOutput> {
    return this.xrpc.procedure(NSID.createPost, input)
  }

  deletePost(input: { uri: AtUri }): Promise<void> {
    return this.xrpc.procedure(NSID.deletePost, input)
  }

  getPost(params: GetPostParams): Promise<PostView> {
    return this.xrpc.query(NSID.getPost, params)
  }
}

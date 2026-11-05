# PRD: Images in the web client

**Status:** Draft, 2026-10-25. Owner: Bretton.

**Backend:** merged to coves `main` as `dfc8d0be`, not yet deployed. The contract is coves `docs/PRD_IMAGES.md` (sections 4–6) and `docs/IMAGE_URL_CONTRACT.md`. The new lexicons are not yet published (they wait on Tidepool's re-sync).

**Backend prerequisites:** coves `docs/PRD_IMAGES_CLIENT_SUPPORT.md`. This PRD needs its B2, which allows comments with images and no text, and its B3, the production Caddy request-body limits (§3.1).

**Scope:**

- Uploading images to posts and comments, with alt text.
- Placing images in the body.
- Rendering galleries, placed images and `imagesWithAttachment`, in posts and in comments.
- Keeping image placements intact when a comment is edited.
- Raising the request-size limits that would otherwise block uploads in production, including the existing avatar-upload failure (`2026-10-25-frontend-avatar-upload-exceeds-request-body-limits`).

## 1. Decisions

| #   | Question                                                             | Decision                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How do uploads reach the AppView?                                    | **Through `/api/proxy`**, the same as every other browser call. Limits are raised for the upload route only (§3.1). Sending uploads straight to `/xrpc` with the session cookie would mean a second authentication path in the browser, and it would bypass the proxy's origin check and header hygiene, for no gain. (Recommended, accepted 2026-10-25.) |
| D2  | When are images uploaded?                                            | **On submit.** Nothing reaches the PDS for a post that is never sent, and abandoned drafts don't use the upload rate limit (60 per 10 minutes). Client-side checks (§3.3) catch most rejections at pick time. Blobs already uploaded are reused when a failed submit is retried. (Recommended, accepted 2026-10-25.)                                      |
| D3  | How are images placed in the body?                                   | **With the backend's `#image` facet.** Every image is stored in `embed.images`. A placed image also gets a facet over a short span of body text, its _covered text_: the alt text, or `[image]` when there is no alt text. That text is what older clients show in place of the image. In the composer the placement is written as a markup token (§4).   |
| D4  | Is composing quote posts, or editing posts, in scope?                | **No.** The web client has neither feature today. It does have comment editing, so editing a comment must keep its images and placements (§4.4).                                                                                                                                                                                                          |
| D5  | What does the feed card show when every image is placed in the body? | **The same as a text post:** no media block. The preview text leaves out the covered text, so the text preview never reads `[image]`. When only some images are placed, the card shows the unplaced ones (§5.3).                                                                                                                                          |
| D6  | Formats                                                              | Upload JPEG, PNG, WebP and GIF, which is the backend's accept list. GIFs are uploaded unchanged, so they keep their animation. The browser can't reliably convert HEIC or AVIF, so those are refused with a message telling the user to convert to JPEG.                                                                                                  |

| D7 | Comments with images and no text | **Allowed** (2026-10-28). The backend change is B2 of `PRD_IMAGES_CLIENT_SUPPORT.md`. Such a comment is sent with empty content (§4.3). |

Confirmed 2026-10-28:

- **Gallery-only posts keep today's layout,** with media above the body. The lexicon's view description says unplaced images render as a gallery _after_ the body. This PRD follows that only when a post has at least one placement (§5.2). Gallery-only posts, including aggregator posts, look the same as today.

## 2. Backend contract (summary)

- **Upload:** `POST /xrpc/social.coves.media.uploadImage`.
  - The body is the raw image bytes, with `Content-Type: image/*`, at most 10,000,000 bytes.
  - The response is `{blob, mimeType, size, aspectRatio}`. The client copies `blob` and `aspectRatio` into `embed.images[].image` and `.aspectRatio`. The server's aspect ratio is measured after orientation, so always use it.
  - The server detects the format from the bytes, strips metadata, applies orientation, and downscales anything with a long edge over 4096.
  - It requires the `blob:*/*` OAuth scope. Older sign-ins get **403 `MissingBlobScope`**.
- **Records:**
  - **Images only:** `social.coves.embed.images` with `{images: [{image, alt?, aspectRatio?}]}`, 1–8 images.
  - **Images plus a link:** a post with images and a URL uses `social.coves.embed.imagesWithAttachment` with `{images: <embed.images>, attachment: <embed.external>}`. Comments can't carry a link attachment, and web has no quote compose, so comments only ever write `embed.images`.
- **The `#image` facet:** `{$type: 'social.coves.richtext.facet#image', index}`, where `index` points into the main `images` list (0–7).
  - It must be the only feature in its facet.
  - Each index may be placed at most once.
  - It must not lie inside `#code` or `#codeBlock`.
  - The range must be non-empty.
- **Views:**
  - `images#view`: `{images: [{thumb, fullsize, alt?, aspectRatio?}]}`.
  - `imagesWithAttachment#view`: `{images: images#view, attachment}`. The attachment is either a flattened `external#viewExternal` (`{$type, uri, title, description, thumb…}`) or a `post#view` that carries only a strongRef. This holds for Bluesky quotes too: nested quotes get no `resolved` data (`internal/core/embeds/view.go`, `projectImagesWithAttachment`).
  - Before serving, the server removes placements that break the rules above, so placements in a view always resolve. The renderer still guards against bad ones (§5.1).
- **Image URLs:**
  - `/img/{preset}/plain/{did}/{cid}`. `thumb` uses `content_preview` (up to 800 px wide) and `fullsize` uses `content_full` (up to 1600 px wide; GIFs are the original animated bytes).
  - The proxy returns **404 until the record is indexed**, and 404 for a removed image.
- **Comments** require non-empty `content`, unless they carry images (B2).

## 3. Upload

### 3.1 Transport and request limits

| Layer                                                      | Today                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Caddy, production (`coves/Caddyfile`, frontend catch-all)  | `request_body max_size 1MB`                                 | Give `POST /api/proxy/xrpc/social.coves.media.uploadImage` its own `max_size 10500000`, and `POST /api/proxy/xrpc/social.coves.actor.updateProfile` its own `max_size 1500000`, with the 1 MB directive excluding both. This change is in the **coves** repo and is delivered by `/home/bretton/Code/coves/docs/PRD_IMAGES_CLIENT_SUPPORT.md` (B3), not by this PRD. The request-limit and avatar fixes are complete only when both B3 and this PRD's `BODY_SIZE_LIMIT` and proxy changes have landed. |
| adapter-node `BODY_SIZE_LIMIT`                             | Unset, so the 512 KB default applies                        | Set it to `10500000` in `docker-compose.prod.yml` and `.env.prod.example`, and document it in `docs/ENVIRONMENT.md`. The setting is global, so Caddy remains the per-route cap.                                                                                                                                                                                                                                                                                                                        |
| `/api/proxy` (`src/routes/api/proxy/[...path]/+server.ts`) | Buffers with `request.blob()`, with a 30 s upstream timeout | For `social.coves.media.uploadImage` only: refuse a `Content-Length` over 10,000,000 (or a body that turns out larger) with 413 `ImageTooLarge` before forwarding, and use a 120 s upstream timeout. Buffering stays: one 10 MB body per in-flight upload is bounded. Origin check, authorization injection and header allowlist are unchanged.                                                                                                                                                        |

- **Client:** add `XrpcClient.procedureRaw(nsid, body: Blob, contentType, {signal, timeoutMs})` in `src/lib/api/coves/xrpc.ts`, and `CovesClient.uploadImage(file, {signal})` in `client.ts`, with the NSID in the table.
  - The content type is the one detected in §3.3, not `file.type`.
  - The client timeout is 120 s, and calls can be cancelled.
- **Avatar uploads (existing defect, fixed here; issue `2026-10-25-frontend-avatar-upload-exceeds-request-body-limits`):**
  - **The defect:** `updateProfile` sends the avatar as base64 JSON, about 1.33 MB for a 1,000,000-byte image (`src/routes/profile/(local_user)/settings/profile-form.ts`). So avatars over about 384 KB raw probably fail in production today against the 512 KB adapter-node default, and over about 750 KB against Caddy's 1 MB cap. This was inferred from the code, not reproduced.
  - **Reproduce first:** on the built adapter-node server without `BODY_SIZE_LIMIT`, an avatar just under 1,000,000 bytes is refused. That is the regression proof.
  - **Fix:** the `BODY_SIZE_LIMIT` change in the table above, together with the Caddy change delivered by coves B3. The avatar keeps its base64 JSON format and its 1,000,000-byte cap.
  - Mark the issue `done` only when both halves (this PRD's `BODY_SIZE_LIMIT` and coves B3) have landed.

### 3.2 Submit flow

1. The user picks, drops or pastes images. Each one is checked (§3.3) and shown from a `blob:` object URL.
2. On submit, images that have no blob yet are uploaded, two at a time, in strip order. Each tile shows its own progress and errors.
3. If any upload fails, the record is not sent. The failed tile shows its error and a Retry button. Images that uploaded successfully keep their blob ref, so a retry uploads only what is missing.
4. Once every image has a blob, the record is created with the embed (§3.4) and facets (§4).
5. Removing or replacing an image throws away its blob ref. The PDS garbage-collects blobs nothing references.
6. The submit button is disabled while uploads or the create request are in flight, so the user can't submit twice.

### 3.3 Client-side checks at pick time

- **Format:** detect it from the file's first bytes (JPEG `FF D8 FF`, PNG signature, `RIFF….WEBP`, `GIF87a`/`GIF89a`), not from `file.type`. Anything else is refused at pick time: "Use a JPEG, PNG, WebP or GIF image." For HEIC/AVIF the message adds "Convert it to JPEG first."
- **Size and pixels:** at most 10,000,000 bytes and 50,000,000 pixels, which are the server's two limits.
  - A JPEG, PNG or WebP over either limit is re-encoded in the browser with the long edge capped at 4096 (the server's own cap), and the result is checked again.
  - An image with transparency stays PNG. Anything else becomes JPEG at quality 0.9.
  - A GIF over either limit is refused, because re-encoding would lose its animation.
- **Count:** at most 8 per post or comment. Images past the eighth are refused with a message saying so.
- **Alt text:** optional, entered per image, at most 1000 graphemes **and** 10,000 UTF-8 bytes; the server checks both. A counter appears near the limit. Count graphemes with `Intl.Segmenter`, as `compose.ts` already does.

### 3.4 Embed construction

| Images | URL field | Embed                                                            |
| ------ | --------- | ---------------------------------------------------------------- |
| 0      | empty     | none                                                             |
| 0      | set       | `embed.external` (unchanged)                                     |
| 1–8    | empty     | `embed.images`                                                   |
| 1–8    | set       | `embed.imagesWithAttachment` with an `embed.external` attachment |

- Each image is `{image: <blob from upload>, alt?: <trimmed alt, omitted when empty>, aspectRatio: <from upload>}`.
- Comments only ever use `embed.images`.

### 3.5 Errors

- **Messages:** add one to `src/lib/app/util/error.ts` for each upload error name in the lexicon, plus `InvalidEmbed`, `TooManyImages`, `InvalidImageFacet` and `ContentEmpty`. Tile-level errors go on the tile; record-level errors go in the form.
- **`MissingBlobScope` and `PermissionDenied`:** show "Sign in again to upload images" with a Sign in action that starts the existing login flow and comes back to the composer.
  - Sign-in is a full-page OAuth redirect, so the composer page is lost. Before redirecting, save the text of the open composer to `sessionStorage` and restore it on return: for the post form, title, URL and body; for a comment or reply composer, its text, with the same composer reopened (the reply form under the same comment). Decided 2026-10-28.
  - Image files and alt texts aren't saved; the user adds the images and their alt texts again. The prompt says "Your text will be kept; add the images again after signing in."
  - The current 401-only session-expiry logic is unchanged.
- **Retry timing:**
  - `UploadRateLimited` (429, the AppView's ten-minute window) says to try again in ten minutes.
  - `RateLimitExceeded` comes from the user's PDS, whose window isn't known, so it says "try again later".
  - Retry stays available for both.

## 4. Placement in the body

### 4.1 Composer syntax

- **Token:** a placed image is written `![covered text](image:N)`.
  - `N` is the image's 1-based position in the attachment strip, and each tile shows its number.
  - The bracket text is the covered text, exactly as it will be stored.
- **Insert in text:** each tile has this action. It inserts the token on its own line at the caret. The bracket text is the image's alt text with whitespace runs (newlines included) collapsed to single spaces and cut to 100 graphemes, or `[image]` when there is no alt text.
  - Changing the alt text later doesn't change a token already inserted. The user edits the bracket text directly if wanted.
  - Typing a token by hand works too.
- **Where a token is recognised:** anywhere outside code spans, code blocks and link text, including mid-paragraph and inside quotes, headings and spoilers. The lexicon forbids only code. It must also:
  - have non-empty bracket text;
  - name an existing attachment with `N`;
  - be the first occurrence of that `N`.

  Anything else stays literal text. The preview shows that text as it will be posted, so the user can see that the token didn't work.

- `![alt](https://…)` keeps today's behaviour. External URLs never become images.

### 4.2 Compilation (`src/lib/feature/richtext/compose.ts`)

- `parseMarkup(source, {imageCount})` replaces a recognised token with its bracket text and emits a facet over that text with the single feature `{$type: 'social.coves.richtext.facet#image', index: N-1}`.
  - `imageCount` is the only new input. Every caller passes it: the post and comment forms, their previews, `buildCommentCreate`, `buildCommentUpdate` and `editorSourceFor`. A caller with no images passes 0, so every token stays literal.
- `toFacets` never merges an `#image` feature into another facet, even when the byte ranges match.
- The covered text is plain: no other formatting is applied to it, and link and mention detection skip it.
- `trimRichText` keeps placement ranges valid, as it already does for other ranges.
- **Strip changes:**
  - Removing image N from the strip removes its token and renumbers the higher tokens in the text.
  - Reordering the strip renumbers the tokens to match.
- The composer preview renders placed images from their `blob:` URLs at their positions, and shows unplaced images as the gallery after the body.

### 4.3 Image-only comments

- **Sending:** a comment with images and no text is sent with `content: ""` and no facets, and its images render as the gallery (B2). The comment form's empty-text check (`buildCommentCreate` and the form's submit guard) allows empty text when at least one image is attached. Without images, empty text is still refused.
- **Editing:** a comment that has images may be saved with all its text removed.
- **Notifications:** a notification row whose preview text is empty because its comment has only images shows "Image" in place of the text.

### 4.4 Comment edit round-trip (fixes current silent loss)

- **Today:** editing drops `#image` features (`facets.ts` treats them as unknown) and recompiles without them. The images fall back to the gallery and the covered text stays as literal text.
- **Required changes:**
  - `serializeMarkup` turns each placement back into `![covered text](image:index+1)` at its own position. It escapes the covered text the way link text is escaped already.
  - Because the token carries the stored covered text and can sit anywhere outside code, placements written by any client round-trip unchanged. This includes mid-paragraph placements, placements inside quotes or spoilers, and covered text that doesn't match the alt text.
  - `editorSourceFor` and `buildCommentUpdate` pass `imageCount` (§4.2), so placements survive the content-equality check and the recompile.
  - The editor shows the comment's images as a read-only strip, numbered and with Insert in text, so placements can be moved, removed or added. The image set itself can't change: no adding, removing or reordering, and no alt edits. `record.embed` is still carried over as it is.
- **A placement the token can't express:** its range partly overlaps another facet's range, for example half of it bold. That placement is dropped when editing starts, so the image falls back to the gallery; the rest of the comment's formatting is kept. The editor shows a one-line notice that it was removed.
- **Round-trip tests:**
  - Saving without changes produces byte-identical `content` and `facets`, for top-level, mid-paragraph, in-quote and in-spoiler placements, and for covered text that differs from the alt text.
  - Inserting text before a placement, and deleting across one, gives facets that point at the right bytes.

## 5. Rendering

### 5.1 Types and guards

- **Types:** add these to `src/lib/api/coves/types.ts`:
  - `BlobRef`
  - `ImagesEmbedRecord`
  - `ImagesWithAttachmentRecord` and `ImagesWithAttachmentView`
  - an `ImageFacetFeature` in the facet feature union
  - `UploadImageOutput`
  - typed `embed` fields on the create and update inputs
- **Remove `EmbedImage.image`.** The server never sends it, so `extractEmbedUrl` returning `images[0].image` was always undefined. This closes `2026-10-06-frontend-extractembedurl-images-view-undefined`.
- **Shared helper:** one `imageLayout(embed, content, facets)` returns `{gallery: EmbedImage[], placed: Map<facetIndex, EmbedImage>}`, where `gallery` is the main gallery minus placed images. The rich-text renderer and the gallery both use this same accepted set, so an image is never dropped from the gallery without being drawn in the body.
- **Guards:** a placement is accepted only if all of these hold:
  - its index resolves in the main gallery, and it is the first placement of that index;
  - it is the facet's only feature;
  - its range is non-empty, within `content`, and on UTF-8 character boundaries;
  - it isn't inside a `#code` or `#codeBlock` range.

  Otherwise the facet's text renders as plain text and the image stays in the gallery. The server filters most of these already; the client guard covers raw-record fallbacks and the checks the server doesn't make.

- **URLs:** `thumb` and `fullsize` go through `isWebUrl` before use. This closes `2026-09-29-native-image-embed-src-skips-web-url-gate`.

### 5.2 Post page and comments

- **Body:** `RichText` gets a block image node. A placed image ends the current paragraph and renders as a block at its position:
  - `fullsize`, sized from `aspectRatio`, at most the body width;
  - alt text as the `alt` attribute;
  - click opens the lightbox at that image.

  Inside a blockquote it renders inside the quote. Inside a spoiler it stays hidden until the spoiler is revealed. Inside a heading it renders after the heading.

- **Gallery** (replaces the single-image `PostImage`):
  - 1 image: full width, sized from `aspectRatio`.
  - 2–4 images: a two-column grid.
  - 5–8 images: a grid with a "+N" overlay on the last visible tile.
  - Space is reserved from `aspectRatio`, or 4:3 when it's missing, so loading causes no layout shift.
  - Each image keeps its own ALT badge, placed as a sibling of the expand button rather than inside it. This closes `2026-09-29-postimage-alt-button-nested-in-expand-button`.
- **Gallery position:**
  - Posts with no placements: above the body, as today.
  - Posts with at least one placement: after the body.
  - Comments: always after the body.
- **Lightbox** (`ExpandableImage.svelte`): opens on a list of images at an index. It has previous and next (buttons and arrow keys), shows alt text, closes on Escape and returns focus to where it was. The sequence follows screen order: placed images in body order, then the gallery in index order.
- **`imagesWithAttachment`:** the images render as above.
  - An external attachment renders as the existing link card (`PostLink`) below the images.
  - A post attachment renders nothing. The nested quote carries only a strongRef (§2), Bluesky quotes included, and neither quote card can render without resolved data. Resolving nested quotes, and a Coves quote card, are out of scope (D4).
- **Comments** (`Comment.svelte`): render `embed.images` and the images of `imagesWithAttachment` with the same components. Comment images get no NSFW blur here; that belongs to the separate comment-NSFW moderation work.
- **Collapse:** `PostBody`'s overflow measurement runs again when an inline image loads. Reserving space from `aspectRatio` keeps `VirtualFeed`'s height estimates close.

### 5.3 Feed cards and compact views

- **Media block:** `nativeImage`, `PostMedia`, `PostMediaCompact`, `mediaType` and the other switches in `helpers.ts` handle `imagesWithAttachment`. They use `imageLayout().gallery`, which holds the unplaced images only.
  - Gallery empty and no attachment: no media, so the card is a text post (D5).
  - Gallery not empty: the first unplaced image, plus a count badge when there are more.
- **Preview text:** leaves out the covered text of valid placements and collapses the blank line left behind.
- **Card body** (confirmed 2026-10-28): a feed card renders the body with no inline images and without the covered text of valid placements; the media area shows only the unplaced images. The post page renders placements inline (§5.2).
- **NSFW tile:** the blurred preview tile appears whenever there is at least one image (placed or not). Concealment keeps hiding both body and media.
- **RSS** (`src/lib/server/rss/items.ts`, `html.ts`):
  - `imagesWithAttachment` renders its images and then the link.
  - Placed images render as `<img>` at their position.
  - The gallery is appended after the body.

### 5.4 Images that fail to load

- **Detection:** the browser can't tell a 404 from other failures. `<img onerror>` doesn't expose the status, and the CSP `connect-src` blocks probing `img.coves.social`. So any failed load counts as unavailable.
- **Placeholder:** gallery tiles, inline images, compact thumbnails and the lightbox show a neutral "Image unavailable" placeholder at the reserved size. The broken image is never shown. There is no retry button; reloading the page retries.
- **Right after posting:** the proxy returns 404 until the record is indexed. The optimistic post (`fresh-post.ts`) and the optimistic comment therefore render images from the composer's `blob:` URLs. They switch to proxy URLs only when the server's copy replaces the optimistic one. Object URLs are revoked once they are no longer used.

## 6. Out of scope

- Composing quote posts, a Coves quote card, and post editing (D4).
- Changing a comment's image set when editing (§4.4).
- Images from external URLs in the body.
- NSFW blur for comment images (separate moderation work).
- Banner upload. The web client has none today.
- A drag-to-place or WYSIWYG editor. The token is the whole placement UI.
- Telling a removed image apart from other load failures (§5.4).

## 7. Testing

- **Unit (Vitest):**
  - format sniffing and size checks;
  - embed construction for every row of §3.4;
  - token compilation: valid, invalid, duplicate, inside code, inside link text, mid-paragraph, inside a quote, a missing `N`, empty bracket text;
  - alt-text limits, with a multi-codepoint grapheme case that passes 1000 graphemes but exceeds 10,000 bytes;
  - `toFacets` keeping `#image` separate;
  - renumbering on remove and reorder;
  - image-only comments: empty content with images is sent, empty content without images is refused;
  - the serialize round-trip (§4.4);
  - `imageLayout` and every guard, including out-of-bounds and non-boundary ranges;
  - preview-text exclusion;
  - error mapping.
- **Browser tests (`*.browser.test.ts`):**
  - the gallery at 1, 2, 4, 5 and 8 images;
  - lightbox navigation and focus;
  - inline images inside blockquote and spoiler;
  - `imagesWithAttachment` with a link, and with a strongRef-only quote (images render, the quote doesn't);
  - comment embeds;
  - the unavailable placeholder;
  - the feed card of a post whose images are all placed.

  Fix the existing fixtures that set `image`.

- **Proxy tests:**
  - a binary body passes through unchanged, with its `Content-Type`;
  - 413 above 10,000,000 bytes;
  - the 120 s timeout applies to uploads only;
  - other routes keep 30 s.
- **SSR tier:** a built `ADAPTER=node` server with `BODY_SIZE_LIMIT=10500000` accepts a 9.9 MB upload and a 999,000-byte avatar save through `/api/proxy`, and refuses both without the setting. The setting-off case is the regression proof for production.
- **Caddy:** tested by coves B3 (`caddy adapt` and a local request through the production config), not here.
- **Live check, local stack** (real local PLC/PDS accounts; no public hosts):
  - sign in;
  - post 3 images with alt text, two of them placed, plus a URL;
  - check the record on the PDS (an `imagesWithAttachment` embed, the facets and the blob refs);
  - check that the post page, feed card and RSS render as specified;
  - comment with one image and no text;
  - edit that comment and confirm the placements survive;
  - keep the image URLs of an already-loaded view, have an admin remove the post, then load those URLs uncached (a fresh page with the cache disabled) and confirm the placeholder appears. The refetched post itself shows the moderation tombstone, which is checked separately;
  - sign in with a session that lacks `blob:*/*`, if one can be produced, and confirm the sign-in-again prompt and the text restore, for the post form and for a reply.

  The image-only comment and its edit need B2 on the local backend. Until B2 is there, those two checks are reported `live: blocked — needs backend B2`; that is recorded as not passed, and they must pass before this work merges to main. The conditional allowance for the old-scope session does not extend to them.

- **Production check after deploy:** with a test account, `curl` a 9.9 MB upload through `https://coves.social/api/proxy/...`, and save an avatar just under 1,000,000 bytes from the web settings page. This confirms the Caddy and `BODY_SIZE_LIMIT` changes.

## 8. Rollout

- **Rendering first:** chunks 1, 2, 6, 7 and 8 can ship before the backend deploy. They are safe against today's production API, which serves `images#view` and never `#image` facets.
- **Avatar fix:** the `BODY_SIZE_LIMIT` part of chunk 3 and coves B3's Caddy change can deploy at any time. Together they fix avatar saves straight away; neither does alone.
- **Composing after:** uploading (chunks 3–5) ships only after the backend deploy, which makes `uploadImage` and B2 live. The Caddy and `BODY_SIZE_LIMIT` changes must be live before or with it.
- **Comment edit (chunk 9) ships with the backend deploy.** Once any client can write placements, today's edit path drops them.

## 9. Chunks

| #   | Chunk                                                                                                                                                                                      | Depends on |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| 1   | Types, `imageLayout` helper and guards, and removing `EmbedImage.image`                                                                                                                    | —          |
| 2   | Gallery component, lightbox navigation and unavailable placeholder; replaces `PostImage`                                                                                                   | 1          |
| 3   | Upload transport: `procedureRaw` and `uploadImage`, the proxy upload cap and timeout, `BODY_SIZE_LIMIT`, the avatar repro, and the SSR-tier test (the Caddyfile matchers are coves B3)     | —          |
| 4   | Composer attachments: pick, drop and paste, the §3.3 checks, alt text, submit flow, embed construction, errors and sign-in-again; post and comment forms; the optimistic `blob:` rendering | 2, 3       |
| 5   | Placement: token compilation, `toFacets` change, renumbering, preview; image-only comments and their notification fallback                                                                 | 4          |
| 6   | Rendering placements: the `RichText` image node, gallery position, collapse re-measure                                                                                                     | 2          |
| 7   | `imagesWithAttachment` in every switch, comment embed rendering, feed card rules and preview-text exclusion                                                                                | 2, 6       |
| 8   | RSS                                                                                                                                                                                        | 6, 7       |
| 9   | Comment edit round-trip                                                                                                                                                                    | 5, 6       |

## Implementation notes

Built by /prd-loop on `prd/prd_images_web` (base `eb3b7d25`). Chunks were re-cut from §9 into 12 tasks with no added scope.

### Chunks

- 01 Image gallery, lightbox navigation, unavailable placeholder — 2bd12b08
- 02 Request-size limits for uploads and avatars (frontend half) — 298e4340
- 03 `imagesWithAttachment` and comment image embeds — 9d095552
- 04 Rendering placed images — f3f43113
- 05 Attaching and uploading images to a post — 76befeca
- 06 Re-encoding oversized images in the browser — 6e26a9b6
- 07 Images on comments and image-only comments — a72fd613
- 08 Images in RSS — 76bf47d6
- 09 Placing images in the body, and keeping placements when a comment is edited — d87b348b
- 10 Sign in again to upload images — 91ac80ec
- 11 Translate the image feature's messages — 49c1e1de
- 12 Signed-in full load of the post composer stays on the composer — dfbe4e39

### Interfaces and conventions

- Image URLs: `imageUrl(image, variant)` and `bestImageURL` return `string | undefined`; `EmbedImage` has no `image` field. Every rendered URL passes `isImageSourceUrl` in `src/lib/api/coves/image-proxy.ts` (HTTP(S), or a live `blob:` URL from `createLocalImageUrl` in `src/lib/feature/image-upload/local-image-urls.ts`). The lightbox in `ExpandableImage.svelte` uses the same gate. Composer previews and optimistic views must create object URLs through `createLocalImageUrl`. CSP `img-src` already allows `blob:`.
- Lightbox: `showImage(images, index)` and `LightboxImage` are exported from `src/lib/ui/generic/ExpandableImage.svelte`; `PageState` holds `openImages` and `openImageIndex`. Prev/next wraps; an unsafe fullsize opens with `url: ''` and shows the placeholder.
- Gallery: `PostGallery {images, blur?, priority?, placedImages?}`; 5 to 8 images show 4 tiles with "+N" on the fourth. `ImageUnavailable.svelte` is the shared placeholder. Keep direct-child display overrides off media wrappers (they broke the grid).
- `embedImages(embed)` in `src/lib/feature/post/helpers.ts` returns images for `images#view` and `imagesWithAttachment#view`. `galleryEmbed(embed, gallery)` keeps an external attachment as a link card when every image is placed. helpers.ts must not import image-layout (cycle); callers pass `removePlacedText(...)` output to `postTextFallback`.
- Placements: `src/lib/feature/richtext/image-layout.ts` (`imageLayout`, `acceptedPlacements`, `placedImageIndexes`, `removePlacedText`); `facets.ts` `buildRichTextWithPlacements` and `PlacedBlock`. RichText always renders the image-aware tree; feed cards pass `inlineImages={false}`. Lightbox order is placed images then gallery.
- Composing: `compose.ts` `findPlacementTokens(source, imageCount)`; `parseMarkup`/`composeRichText` take `{imageCount}`. `serialize.ts` turns placements back into markup and drops a placement that another kept placement covers, whose covered text has a newline, that half-overlaps bold, or that exactly coextends a link. `comment-submit.ts` `editorSourceFor(record, imageCount)` returns `{source, droppedPlacements}`; editing must keep `record.embed`.
- Uploads: `src/lib/feature/image-upload/` (`Attachments`, `AttachmentStrip`, `image-file.ts`, `reencode.ts`, `draft-restore.ts`). Build attachments through `Attachments` (or call `prepareImageFile`) to get pick-time checks and re-encoding (long edge at most 4096, never upscaled). `Attachments` takes a `post` or `comment` target for the over-8 wording. Two uploads in flight; `embedFor(url)` throws if an image lacks a blob ref.
- Errors: `XrpcError` carries `nsid`. Upload-worded messages and "Sign in again to upload images" apply only when `nsid` is `uploadImage`; `TooManyImages` from `createComment`/`updateComment` uses the comment wording. `isUploadSignInError(error)` is in `src/lib/app/util/error.ts`.
- i18n: every user-facing string is a key in `src/lib/app/state/i18n/en.json` only (`$t` in markup, `t.get` in .ts, `{{name}}` interpolation). RSS text and proxy JSON `message` bodies stay English.
- Comments: `CreateCommentInput.embed` is `ImagesEmbedRecord`; `buildCommentCreate` throws `CommentContentEmptyError` when there is no text and no image. Optimistic comments carry blob: previews in `comment.embed` and the uploaded record in `record.embed`. CommentForm hands the strip to the optimistic comment on success; ReplyCard and CommentProvider revoke previews they drop.
- Notifications: a comment with no preview shows "Image" (`isBlank` in `src/lib/feature/notification/rows.ts`), because the backend omits empty fields.
- Sign-in again: one sessionStorage entry `coves.composerDraft`, keyed by pathname and validated per kind on read. Only text is restored (post title/URL/body, or the open comment or reply), not images or alt text.
- Proxy (`src/routes/api/proxy/[...path]/+server.ts`): an upload over 10,000,000 bytes gets 413 `ImageTooLarge` before the body finishes; Firefox `fetch()` sees `TypeError: NetworkError`, not the 413, so the composer checks size before upload. Upload timeout 120 s. `BODY_SIZE_LIMIT=10500000` is pinned in `docker-compose.prod.yml` `environment:`.
- RSS: `richTextToRssHtml(content, facets, origin, placed, itemLink)` in `src/lib/server/rss/html.ts`; a placed image in a spoiler renders as its own `<details>`. Markdown bodies get no placements.
- SSR test helpers: `tests/ssr/built-server.ts`; `tests/ssr/mock-upstream.ts` has uploadImage/updateProfile handlers and the `RSS_IMAGE_POST` fixture.
- Rollout (§8): 01, 03, 04, 08 are rendering-only and safe now. 02's `BODY_SIZE_LIMIT` can deploy any time; the avatar fix and full request-limit fix also need the production Caddyfile `request_body` matchers (coves `docs/PRD_IMAGES_CLIENT_SUPPORT.md` B3). 05–07, 09, 10 ship only after the coves images deploy (`dfc8d0be`) and B2, with Caddy and `BODY_SIZE_LIMIT` live before or with them.
- Main has moved past the base; merge main into the branch at merge time (rebase is blocked).

### Deferred review findings (open)

- 01: lightbox `failed` set is never cleared and `onerror` reads the current URL, not the failed one; "+N" tile's aria-label hides the count.
- 02: 413 bodies omit `requestId`; SSR tests do not assert the 413 error names; doc comments describe Caddy per-route caps as already live.
- 03: compact image-count badge is not announced to screen readers; external-attachment check written twice.
- 04: code-block guard uses the raw facet range, not the line-extended block; a fully covered heading renders an empty `<hN>`; reveal state not cleared when content changes; spoilered image is blurred, not unloaded.
- 05: client upload timeout shows "can't reach the server"; alt byte-limit message says "1000 characters"; previews leak if the post page never mounts; `MAXIMUM_ATTACHMENTS` defined twice.
- 06: "Resizing image..." status region may not be announced; pass `imageOrientation: 'from-image'` to `createImageBitmap`.
- 07: browser tests use fixed-tick `settle()`; one log label covers every submit failure; previews revoked if the form unmounts mid-create.
- 08: spoilered placed image test does not pin that the image stays inside `<details>`.
- 09: heading/blockquote containment uses raw ranges in the serializer; multi-line placements are dropped; emphasis scan is O(n³) on adversarial lines; default `TextDecoder` strips a leading BOM.
- 10: `goto()` in `signIn()` is not awaited or caught; two notification rows with the same parent both open, only the first gets the text.
- 11: a refusal already on screen keeps its old language after a locale change.
- 12: test-only type cleanups.

### Live checks still open

- 07: paste and drag-drop an image into the comment box by hand in a real browser (only synthetic events were tried).
- 05: admin removal shows "Image unavailable" for each noted image URL on a fresh page (needs a local admin).
- 07/09: image-only comment, then edit it and confirm placements survive (needs backend B2 on the dev backend).
- 06: re-encode on a phone.
- 10/12: after merge, the sign-in-again post round trip (prompt, OAuth, title/URL/body restored, composer stays open) on a single origin.

### Scope proposals awaiting a decision

- 10: expire the composer draft so an abandoned login does not reopen stale text (~10 LOC).
- 10: restore into unloaded subtrees and notification pages by loading through to the saved parent (40–100 LOC).
- 10: show "draft could not be restored" (~15 LOC).
- 12: keep signed-in users on /create/post, /notifications and /profile during transient `/api/me` failures (429, network, timeout) (~10 LOC plus tests).

### Related backlog issues

- `2026-10-29-profile-redirects-to-login-on-stale-local-profile`: open; the same bug chunk 12 fixed, on /profile.
- `2026-10-16-create-post-redirects-on-stale-local-profile`: fixed by chunk 12; close it once the branch is on main.

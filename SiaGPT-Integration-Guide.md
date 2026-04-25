# SiaGPT Backend Integration Guide

**Version**: 1.1
**Last Updated**: April 2026
**Base URL**: `https://backend.siagpt.ai`  
**Auth Provider**: Zitadel (`https://zitadel.heka.ai`)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites & Credentials](#2-prerequisites--credentials)
3. [Authentication](#3-authentication)
4. [Core Workflow](#4-core-workflow)
5. [API Reference](#5-api-reference)
6. [Response Format & Parsing](#6-response-format--parsing)
7. [Assistants & Configuration](#7-assistants--configuration)
8. [Full API Endpoint Catalog](#8-full-api-endpoint-catalog)
9. [Client Code — TypeScript](#9-client-code--typescript)
10. [Client Code — Python](#10-client-code--python)
11. [Environment Variables](#11-environment-variables)
12. [Vite Dev Proxy Setup (Frontend)](#12-vite-dev-proxy-setup-frontend)
13. [Gotchas & Tips](#13-gotchas--tips)

---

## 1. Overview

SiaGPT is a secure, project-aware LLM backend that provides:

- **Persistent discussions** — conversation threads with full message history
- **File attachments** — upload documents (PDF, etc.) for context-aware RAG
- **Collections (Projects)** — persistent document collections for RAG context across conversations
- **Configurable assistants** — custom system prompts, JSON output schemas, and LLM bundle selection
- **Project isolation** — all data is scoped to a Project ID

Unlike public LLM APIs (OpenAI, Gemini), SiaGPT requires **JWT-based authentication** via OAuth2 (Zitadel), not a simple API key.

---

## 2. Prerequisites & Credentials

You need the following from the SiaGPT Platform Team before writing any code:

| Credential                       | Description                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **SIAGPT Project ID**            | UUID of your project in SiaGPT. Used as `ownerId` in API calls. Ensures data isolation.                                           |
| **Zitadel Project ID**           | UUID of the project within the Zitadel identity provider. Used only in the OAuth2 scope string.                                   |
| **OAuth2 Client ID**             | Your application's OAuth2 client identifier.                                                                                      |
| **OAuth2 Client Secret**         | Your application's OAuth2 secret. **Keep this secure — never expose in frontend builds.**                                         |
| **OAuth2 Token URL**             | Zitadel token endpoint, e.g. `https://zitadel.heka.ai/oauth/v2/token`                                                             |
| **API Base URL**                 | SiaGPT backend URL: `https://backend.siagpt.ai`                                                                                   |
| **Bundle ID** _(optional)_       | UUID of the LLM bundle (model configuration) to use. If not provided, the assistant's default bundle is used.                     |
| **Assistant ID** _(optional)_    | UUID of a pre-configured assistant with a specific system prompt and JSON schema. You can create your own or use a shared one.    |
| **Media Folder ID** _(optional)_ | UUID of the root folder containing project collections. Required for collections/media features. Set as `SIAGPT_MEDIA_FOLDER_ID`. |

---

## 3. Authentication

SiaGPT supports two authentication methods:

### Option A: OAuth2 Client Credentials (Recommended for Production)

This is the standard approach. The client exchanges credentials for a JWT token via Zitadel.

**Token Request:**

```
POST {OAUTH2_TOKEN_URL}?grant_type=client_credentials&scope={SCOPE_PARAMS}

Headers:
  Content-Type: application/x-www-form-urlencoded
  Authorization: Basic {base64(CLIENT_ID:CLIENT_SECRET)}
```

**Scope string** (URL-encoded `+` as space separator):

```
openid+urn:zitadel:iam:user:resourceowner+urn:zitadel:iam:org:project:id:{ZITADEL_PROJECT_ID}:aud+urn:zitadel:iam:org:projects:roles
```

**Critical implementation detail:** The `grant_type` and `scope` parameters must be passed as **URL query parameters**, not in the request body. This is a Zitadel-specific behavior — when passed in the body, Zitadel returns an opaque access token instead of a JWT.

**Token selection priority:**

1. If `access_token` looks like a JWT (contains exactly 2 dots → 3 segments), use it.
2. Otherwise, use `id_token` (always a JWT).
3. Fallback to opaque `access_token` (may not work with SiaGPT backend).

### Option B: Static Bearer Token (For Development/Testing)

If you have a valid JWT (e.g. extracted from browser DevTools while logged into the SiaGPT web app), you can use it directly. This skips OAuth2 entirely.

**How to get one manually:**

1. Log in to the SiaGPT web app
2. Open browser DevTools → Network tab
3. Find any API request and copy the `Authorization: Bearer <token>` header value

**Note:** These tokens expire. This method is only suitable for development.

### Required Headers for All API Calls

Once you have a token, every API request must include:

```
Authorization: Bearer {JWT_TOKEN}
app-origin: AI Platform
```

The `app-origin: AI Platform` header is required by the backend.

---

## 4. Core Workflow

The standard integration pattern follows three steps:

```
1. Create Discussion  →  Get discussion UUID
2. Upload Attachments →  Get attachment info (optional, if you have files)
3. Post Message       →  Get LLM response
```

You initialize the client **once**, then call these APIs as needed. Discussions persist — you can send multiple messages to the same discussion for multi-turn conversations.

### Minimal Flow (Text Only)

```
Client Init
    │
    ▼
Create Discussion ─── POST /chat/discussions
    │                   Returns: { uuid: "..." }
    ▼
Post Message ──────── POST /chat/messages/
    │                   Returns: LLM response (see §6)
    ▼
(Repeat Post Message for follow-up turns)
```

### Full Flow (With File Attachments)

```
Client Init
    │
    ▼
Create Discussion ─── POST /chat/discussions
    │
    ▼
Upload Attachments ── POST /chat/attachments
    │                   Returns: [{ uuid, name, ... }]
    ▼
Post Message ──────── POST /chat/messages/
    │                   (include attachmentInfos from step above)
    ▼
(Repeat Post Message for follow-up turns)
```

### Collections Flow (Persistent RAG)

Collections provide persistent document storage that can be referenced across multiple discussions, unlike per-message attachments.

```
Client Init
    │
    ▼
List Collections ──── GET /folders/{folderId}
    │                   Filter: icon.value === "Files"
    ▼
Create Collection ─── POST /medias/collections       (if needed)
    │                   Body: { name, description, folderId }
    ▼
Upload Media ──────── POST /medias/
    │                   Multipart: file + media_metadata JSON
    ▼
Create Discussion ─── POST /chat/discussions
    │
    ▼
Post Message ──────── POST /chat/messages/
    │                   messageMetadata.collectionIds = [collectionUUID]
    ▼
(Backend performs RAG search across collection documents)
```

---

## 5. API Reference

### 5.1 Create Discussion

Creates a new conversation thread.

```
POST /chat/discussions
Content-Type: application/json
```

**Request Body:**

```json
{
  "name": "My Investigation - 2026-03-04 10:30:00",
  "ownerId": "{SIAGPT_PROJECT_ID}",
  "ownerType": "PROJECT"
}
```

**Response:**

```json
{
  "uuid": "019c1234-abcd-7890-ef12-345678901234"
}
```

**Notes:**

- `name` is a human-readable label for the discussion.
- SiaGPT may auto-rename discussions after the first message. If you need a stable name, call `PATCH /chat/discussions/{id}` after each message to re-enforce it.

---

### 5.2 Update Discussion

Rename or modify an existing discussion.

```
PATCH /chat/discussions/{discussion_id}
Content-Type: application/json
```

**Request Body:**

```json
{
  "name": "Updated Discussion Name"
}
```

---

### 5.3 Upload Attachments

Upload files (PDF, images, etc.) that the LLM can use as context for RAG.

```
POST /chat/attachments
Accept: application/json
Content-Type: multipart/form-data   ← set automatically, DO NOT set manually
```

**Form Fields:**

- `files` — one or more files (repeat the field for multiple files)
- `discussionId` — _(optional)_ UUID of the discussion to associate with

**Response:**

```json
{
  "attachmentInfos": [
    {
      "uuid": "019c5678-abcd-...",
      "name": "document.pdf",
      "success": true
    }
  ]
}
```

**Important:** When using `fetch` or similar, do NOT manually set the `Content-Type` header when sending `FormData`. The browser/library must set it automatically to include the multipart boundary.

---

### 5.4 Post Message

Send a message to the LLM within a discussion and get a response.

```
POST /chat/messages/
Content-Type: application/json
```

**Request Body:**

```json
{
  "question": "Your prompt or user message here",
  "messageId": "019c9abc-1234-7def-...",
  "discussionId": "{DISCUSSION_UUID}",
  "ownerId": "{SIAGPT_PROJECT_ID}",
  "ownerType": "PROJECT",
  "assistantId": "{ASSISTANT_UUID}",
  "messageMetadata": {
    "feedback": "DEFAULT",
    "bundleId": "{BUNDLE_UUID}",
    "attachmentInfos": [{ "uuid": "...", "name": "document.pdf" }],
    "collectionIds": ["{COLLECTION_UUID}"]
  }
}
```

**Field Details:**

| Field                             | Required | Description                                                                                                      |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `question`                        | Yes      | The user's message or prompt text                                                                                |
| `messageId`                       | Yes      | A unique UUID v7 for this message. Generate client-side.                                                         |
| `discussionId`                    | Yes      | UUID from `Create Discussion`                                                                                    |
| `ownerId`                         | Yes      | Your SIAGPT Project ID                                                                                           |
| `ownerType`                       | Yes      | Always `"PROJECT"`                                                                                               |
| `assistantId`                     | No       | UUID of the assistant to use. Determines system prompt, JSON schema, and behavior.                               |
| `messageMetadata.feedback`        | No       | Set to `"DEFAULT"`                                                                                               |
| `messageMetadata.bundleId`        | No       | UUID of the LLM bundle (model config) to use                                                                     |
| `messageMetadata.attachmentInfos` | No       | Array of attachment objects returned from the upload step                                                        |
| `messageMetadata.collectionIds`   | No       | Array of collection UUIDs. Enables RAG — the backend searches these collections' documents for relevant context. |

**Note:** Attachments are per-message file uploads. Collections are persistent document stores — upload files once, then reference the collection across many messages and discussions via `collectionIds`.

**Response:** See [§6 Response Format](#6-response-format--parsing).

---

### 5.5 Update Assistant

Modify an assistant's system prompt, name, or description.

```
PATCH /assistants/{assistant_id}
Content-Type: application/json
```

**Request Body:**

```json
{
  "name": "My Custom Assistant",
  "description": "Assistant for task X",
  "prompt": "You are an expert in... (system prompt)",
  "llmBundleId": "{BUNDLE_UUID}",
  "chainOfThought": "chat"
}
```

All fields are optional — include only what you want to update.

---

### 5.6 Update Assistant JSON Structure

Define the expected JSON output schema for an assistant. When set, the LLM will attempt to return responses conforming to this structure.

```
PATCH /assistants/{assistant_id}/json_structure
Content-Type: application/json
```

**Request Body:**

```json
{
  "json_structure": "{\"key\": \"description of value\", ...}"
}
```

The value of `json_structure` is a **JSON string** (stringified JSON schema).

---

### 5.7 Get Assistant

Retrieve an assistant's current configuration.

```
GET /assistants/{assistant_id}
```

**Response:**

```json
{
  "uuid": "019be645-...",
  "name": "My Assistant",
  "prompt": "You are...",
  "description": "...",
  "llmBundleId": "..."
}
```

---

### 5.8 Get Assistant JSON Structure

```
GET /assistants/{assistant_id}/json_structure
```

Returns the currently configured JSON output schema.

---

### 5.9 List Collections

Retrieve all collections within a folder. Collections are identified by filtering folder items where `icon.value === "Files"`.

```
GET /folders/{folderId}
```

**Response:**

```json
{
  "items": [
    {
      "uuid": "019c1234-abcd-...",
      "name": "My Project",
      "description": "Project description",
      "parentFolderId": "019c0000-...",
      "icon": { "type": "ICON", "value": "Files" },
      "collectionMetadata": "...",
      "createdAt": "2026-04-01T10:00:00Z",
      "updatedAt": "2026-04-01T12:00:00Z"
    }
  ]
}
```

**Important:** Only items where `icon.value === "Files"` are collections. Other items in the folder are not collections and should be filtered out.

---

### 5.10 Create Collection

Create a new collection (project) within a folder.

```
POST /medias/collections
Content-Type: application/json
```

**Request Body:**

```json
{
  "name": "My New Project",
  "description": "Optional project description",
  "folderId": "{MEDIA_FOLDER_ID}"
}
```

**Response:** Returns a `CollectionOut` object with `uuid`, `name`, `description`, etc.

---

### 5.11 Get Collection with Media

Retrieve a collection and its media files.

```
GET /medias/collections/{collection_id}?get_medias=true
```

**Response:**

```json
{
  "uuid": "019c1234-abcd-...",
  "medias": [
    {
      "uuid": "019c5678-efgh-...",
      "name": "document.pdf",
      "mimetype": "application/pdf",
      "createdAt": "2026-04-01T10:00:00Z",
      "updatedAt": "2026-04-01T10:05:00Z",
      "completion": 1.0
    }
  ]
}
```

**Notes:**

- The `completion` field (0.0 to 1.0) indicates document processing/indexing progress.
- Wait for `completion` to reach 1.0 before expecting RAG results from that document.

---

### 5.12 Upload Media to Collection

Upload a file to a collection for RAG indexing.

```
POST /medias/
Accept: application/json
Content-Type: multipart/form-data   ← set automatically, DO NOT set manually
```

**Form Fields:**

- `file` — the binary file (Blob)
- `media_metadata` — a **JSON string**: `"{\"collectionId\": \"019c1234-abcd-...\"}"` (must be stringified, not a raw object)

**Response:** Returns the created media object.

**Important:** The `media_metadata` field must be a stringified JSON object (`JSON.stringify({ collectionId })`), not a raw object. Same as with attachments, do NOT manually set the `Content-Type` header.

---

### 5.13 Get Media Entity

Retrieve details for a specific media entity, including its version and collection references.

```
GET /medias/entities/{entity_id}
```

**Response:**

```json
{
  "uuid": "019c5678-efgh-...",
  "fileName": "document.pdf",
  "externalLink": "https://...",
  "mediaVersionId": "019c9999-...",
  "mediaDefinitionId": "019c8888-...",
  "collectionId": "019c1234-abcd-..."
}
```

Use the `mediaVersionId` to fetch the presigned download URL via the batch endpoint (§5.14).

---

### 5.14 Get Presigned URLs for Media Versions

Fetch presigned S3 URLs for downloading/viewing media files.

```
POST /medias/versions/sources/batch
Content-Type: application/json
```

**Request Body:** Array of media version UUIDs.

```json
["019c9999-abcd-...", "019c9999-efgh-..."]
```

**Response:**

```json
[
  {
    "uuid": "019c9999-abcd-...",
    "name": "document.pdf",
    "summary": "Document summary text...",
    "externalLink": "https://...",
    "path": "https://s3.amazonaws.com/.../presigned-url?..."
  }
]
```

**Notes:**

- The `path` field is the presigned S3 URL — use this to access the raw file.
- Presigned URLs expire. Fetch fresh URLs each time you need to access a file.

---

### 5.15 Get Media Definition

Retrieve a media definition and its version history.

```
GET /medias/{media_definition_id}
```

**Response:**

```json
{
  "uuid": "019c8888-abcd-...",
  "name": "document.pdf",
  "mimetype": "application/pdf",
  "versions": [{ "uuid": "019c9999-abcd-..." }]
}
```

---

## 6. Response Format & Parsing

The `POST /chat/messages/` endpoint can return responses in multiple formats. Your client must handle all of them.

### Format A: Single JSON Object

```json
{
  "event": "CHAT",
  "data": "The LLM's response text or JSON here"
}
```

### Format B: Newline-Delimited JSON (NDJSON / SSE-like)

Multiple JSON objects, one per line:

```
{"event": "CHAT", "data": "partial response..."}
{"event": "OVERWRITE_TEXT", "data": "{\"key\": \"value\"}"}
```

### Event Types

| Event               | Description                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OVERWRITE_TEXT`    | The primary structured response. **Prioritize this.** Contains the final output.                                                                                |
| `CHAT`              | A conversational/text response from the LLM. Accumulates across multiple events.                                                                                |
| `NEW_SOURCES`       | Contains citation sources. Has a different shape: `{ event: "NEW_SOURCES", message_id: "...", sources: { "1": { id, type, url, header, description? }, ... } }` |
| `NEW_TEXT`          | New text chunk (streaming variant).                                                                                                                             |
| `NEW_THINKING`      | Chain-of-thought reasoning text from the LLM (if enabled).                                                                                                      |
| `RENAME_DISCUSSION` | Backend-initiated discussion rename event.                                                                                                                      |
| `DELETE_MESSAGE`    | Backend-initiated message deletion event.                                                                                                                       |

### Parsing Strategy

1. Try `JSON.parse()` on the full response body.
2. If that fails, split by newlines and parse each line individually → collect as an array of events.
3. Look for the `OVERWRITE_TEXT` event first, then `CHAT`, then fall back to the last event.
4. Extract the `data` or `content` field from the chosen event.
5. If `data` is a string, extract the JSON block between the first `{` and last `}` and parse it (LLMs sometimes wrap JSON in markdown or extra text).

### Robust JSON Extraction (from LLM string responses)

LLM responses often contain malformed JSON. Common fixes:

````typescript
// Strip trailing commas before ] or }
text = text.replace(/,\s*([\]}])/g, "$1");

// Fix literal newlines inside JSON string values
text = text.replace(
  /"([^"]*)"/g,
  (match, p1) => '"' + p1.replace(/\n/g, "\\n") + '"',
);

// Strip markdown code fences
text = text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "");
````

---

## 7. Assistants & Configuration

Assistants are pre-configured AI agents with:

- **System Prompt** — instructions that define the assistant's behavior
- **JSON Structure** — an output schema the LLM will try to conform to
- **LLM Bundle** — which model/configuration to use

### Setting Up a New Assistant

You can either:

1. **Use the SiaGPT web UI** to create and configure an assistant, then reference its ID
2. **Use the API** to create and configure programmatically:

```
POST /assistants
Content-Type: application/json

{
  "name": "My Assistant",
  "description": "Does X",
  "prompt": "You are an expert in...",
  "llmBundleId": "{BUNDLE_UUID}",
  "chainOfThought": "chat"
}
```

Then set the JSON structure:

```
PATCH /assistants/{new_assistant_id}/json_structure
Content-Type: application/json

{
  "json_structure": "{\"output_field\": \"description\", ...}"
}
```

### Using an Assistant

Pass the `assistantId` in the `postMessage` call:

```json
{
  "question": "...",
  "assistantId": "019be645-c6a1-7ff4-b723-a74dcc006d4f",
  ...
}
```

The assistant's system prompt and JSON schema will automatically be applied to the LLM call.

---

## 8. Full API Endpoint Catalog

Below is the complete list of endpoints available on the SiaGPT backend.

### Health

| Method | Endpoint   | Description  |
| ------ | ---------- | ------------ |
| `GET`  | `/healthz` | Health check |

### Chat (Discussions & Messages)

| Method  | Endpoint                            | Description                         |
| ------- | ----------------------------------- | ----------------------------------- |
| `POST`  | `/chat/discussions`                 | Create a new discussion             |
| `PATCH` | `/chat/discussions/{discussion_id}` | Update discussion (rename, etc.)    |
| `POST`  | `/chat/attachments`                 | Upload file attachments             |
| `POST`  | `/chat/messages/`                   | Send a message and get LLM response |

### Assistants

| Method   | Endpoint                                          | Description                           |
| -------- | ------------------------------------------------- | ------------------------------------- |
| `GET`    | `/assistants`                                     | List all assistants                   |
| `POST`   | `/assistants`                                     | Create a new assistant                |
| `GET`    | `/assistants/{assistant_id}`                      | Get assistant details                 |
| `PATCH`  | `/assistants/{assistant_id}`                      | Update assistant (prompt, name, etc.) |
| `DELETE` | `/assistants/{assistant_id}`                      | Delete an assistant                   |
| `POST`   | `/assistants/batch`                               | Get multiple assistants by IDs        |
| `GET`    | `/assistants/{assistant_id}/json_structure`       | Get assistant's JSON output schema    |
| `PATCH`  | `/assistants/{assistant_id}/json_structure`       | Update assistant's JSON output schema |
| `GET`    | `/assistants/{assistant_id}/secrets`              | Get assistant secrets                 |
| `PATCH`  | `/assistants/{assistant_id}/secrets`              | Update assistant secrets              |
| `GET`    | `/assistants/{assistant_id}/permissions`          | Get assistant permissions             |
| `GET`    | `/assistants/{assistant_id}/vote`                 | Get user's vote on assistant          |
| `PATCH`  | `/assistants/{assistant_id}/vote`                 | Vote on an assistant                  |
| `GET`    | `/assistants/votes`                               | Get assistants sorted by votes        |
| `POST`   | `/assistants/{assistant_id}/description/generate` | Auto-generate assistant description   |

### LLM Bundles

| Method | Endpoint                              | Description                |
| ------ | ------------------------------------- | -------------------------- |
| `GET`  | `/assistants/bundles`                 | List all LLM bundles       |
| `POST` | `/assistants/bundles`                 | Create a new LLM bundle    |
| `GET`  | `/assistants/bundles/default`         | Get the default LLM bundle |
| `GET`  | `/assistants/bundles/{llm_bundle_id}` | Get a specific bundle      |

### Projects

| Method   | Endpoint                             | Description             |
| -------- | ------------------------------------ | ----------------------- |
| `GET`    | `/projects/{project_id}`             | Get project details     |
| `POST`   | `/projects`                          | Create a new project    |
| `PATCH`  | `/projects/{project_id}`             | Update project          |
| `DELETE` | `/projects/{project_id}`             | Delete project          |
| `GET`    | `/projects/featured`                 | Get featured projects   |
| `GET`    | `/projects/{project_id}/permissions` | Get project permissions |

### Identities

| Method   | Endpoint                                          | Description               |
| -------- | ------------------------------------------------- | ------------------------- |
| `GET`    | `/identities/self`                                | Get current user identity |
| `GET`    | `/identities/users`                               | List users                |
| `GET`    | `/identities/{identity_id}`                       | Get a specific identity   |
| `GET`    | `/identities/self/favorites`                      | Get user's favorites      |
| `PUT`    | `/identities/self/favorites`                      | Add a favorite            |
| `DELETE` | `/identities/self/favorites/{target_favorite_id}` | Remove a favorite         |

### Folders

| Method   | Endpoint                                            | Description               |
| -------- | --------------------------------------------------- | ------------------------- |
| `GET`    | `/folders/shared`                                   | Get shared folders        |
| `GET`    | `/folders/{folder_id}`                              | Get folder                |
| `GET`    | `/folders/{folder_id}/content`                      | Get folder contents       |
| `GET`    | `/folders/{folder_id}/tree`                         | Get folder tree           |
| `POST`   | `/folders/{parent_folder_id}`                       | Create folder             |
| `PATCH`  | `/folders/{folder_id}`                              | Update folder             |
| `DELETE` | `/folders/{folder_id}`                              | Delete folder             |
| `GET`    | `/folders/{folder_id}/permissions`                  | Get folder permissions    |
| `POST`   | `/folders/{folder_id}/permissions`                  | Create folder permissions |
| `DELETE` | `/folders/{folder_id}/permissions/{user_id}`        | Delete folder permissions |
| `PATCH`  | `/folders/{folder_id}/{target_folder_id}`           | Move folder               |
| `PATCH`  | `/folders/{target_folder_id}/{item_type}/{item_id}` | Move item into folder     |

### Collections & Media

| Method | Endpoint                                   | Description                              |
| ------ | ------------------------------------------ | ---------------------------------------- |
| `POST` | `/medias/collections`                      | Create a new collection                  |
| `GET`  | `/medias/collections/{id}?get_medias=true` | Get collection with its media files      |
| `POST` | `/medias/`                                 | Upload a file to a collection            |
| `GET`  | `/medias/entities/{id}`                    | Get media entity details                 |
| `POST` | `/medias/versions/sources/batch`           | Get presigned S3 URLs for media versions |
| `GET`  | `/medias/{media_definition_id}`            | Get media definition                     |

### Batch Processing

| Method   | Endpoint                                                    | Description                   |
| -------- | ----------------------------------------------------------- | ----------------------------- |
| `GET`    | `/batch/definitions/project/{project_id}`                   | Get project batch definitions |
| `POST`   | `/batch/definitions`                                        | Create batch definition       |
| `GET`    | `/batch/definitions/{definition_id}`                        | Get batch definition          |
| `PATCH`  | `/batch/definitions/{definition_id}`                        | Update batch definition       |
| `DELETE` | `/batch/definitions/{definition_id}`                        | Delete batch definition       |
| `POST`   | `/batch/versions/{version_id}/run`                          | Run a batch version           |
| `GET`    | `/batch/versions/{version_id}`                              | Get batch version             |
| `GET`    | `/batch/versions/{version_id}/export`                       | Export batch version          |
| `POST`   | `/batch/versions/{version_id}/query`                        | Create batch query            |
| `PATCH`  | `/batch/versions/{version_id}/query/{query_id}`             | Update batch query            |
| `DELETE` | `/batch/versions/{version_id}/query/{query_id}`             | Delete batch query            |
| `POST`   | `/batch/versions/{version_id}/entries/{entry_id}/reprocess` | Reprocess a batch entry       |

---

## 9. Client Code — TypeScript

Drop-in client for browser or Node.js (with `fetch`). Only dependency: `uuid`.

```bash
npm install uuid
npm install --save-dev @types/uuid   # TypeScript only
```

```typescript
import { v7 as uuidv7 } from "uuid";

export interface SiaGPTConfig {
  baseUrl: string;
  projectId: string;
  bearerToken?: string;
  oauth2TokenUrl?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  zitadelProjectId?: string;
}

export interface AttachmentInfo {
  uuid: string;
  name: string;
  [key: string]: unknown;
}

export interface CollectionOut {
  uuid: string;
  name: string;
  description: string;
  parentFolderId?: string;
  icon?: { type: string; value: string };
  collectionMetadata?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MediaOut {
  uuid: string;
  name: string;
  mimetype?: string;
  createdAt?: string;
  updatedAt?: string;
  completion?: number;
}

export class SiaGPTClient {
  private baseUrl: string;
  private projectId: string;
  private bearerToken?: string;
  private oauth2TokenUrl?: string;
  private oauth2ClientId?: string;
  private oauth2ClientSecret?: string;
  private zitadelProjectId?: string;
  private cachedAccessToken?: string;

  constructor(config: SiaGPTConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.projectId = config.projectId;
    this.bearerToken = config.bearerToken;
    this.oauth2TokenUrl = config.oauth2TokenUrl;
    this.oauth2ClientId = config.oauth2ClientId;
    this.oauth2ClientSecret = config.oauth2ClientSecret;
    this.zitadelProjectId = config.zitadelProjectId;
  }

  private async getAccessToken(): Promise<string> {
    if (this.bearerToken) return this.bearerToken;
    if (this.cachedAccessToken) return this.cachedAccessToken;

    if (
      !this.oauth2TokenUrl ||
      !this.oauth2ClientId ||
      !this.oauth2ClientSecret ||
      !this.zitadelProjectId
    ) {
      throw new Error("Missing OAuth2 configuration.");
    }

    const authStr = btoa(`${this.oauth2ClientId}:${this.oauth2ClientSecret}`);
    const scopeParams = [
      "openid",
      "urn:zitadel:iam:user:resourceowner",
      `urn:zitadel:iam:org:project:id:${this.zitadelProjectId}:aud`,
      "urn:zitadel:iam:org:projects:roles",
    ].join("+");

    const tokenUrl = `${this.oauth2TokenUrl}?grant_type=client_credentials&scope=${scopeParams}`;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authStr}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Auth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Prefer access_token if it's a JWT, otherwise use id_token
    const accessToken = data.access_token;
    const idToken = data.id_token;

    if (accessToken && accessToken.split(".").length === 3) {
      this.cachedAccessToken = accessToken;
    } else if (idToken) {
      this.cachedAccessToken = idToken;
    } else if (accessToken) {
      this.cachedAccessToken = accessToken;
    } else {
      throw new Error("OAuth2 response missing usable token.");
    }

    return this.cachedAccessToken!;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/${endpoint.replace(/^\/+/, "")}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "app-origin": "AI Platform",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401 && this.cachedAccessToken) {
        this.cachedAccessToken = undefined;
      }
      const text = await response.text();
      throw new Error(`SiaGPT API Error ${response.status}: ${text}`);
    }

    const text = await response.text();
    return this.parseResponseText<T>(text);
  }

  private parseResponseText<T>(text: string): T {
    if (!text.trim()) return {} as T;
    try {
      return JSON.parse(text);
    } catch {
      // NDJSON: multiple JSON objects separated by newlines
      const events = text
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return undefined;
          }
        })
        .filter((x): x is Record<string, unknown> => x !== undefined);
      if (events.length === 0) return {} as T;
      return (events.length > 1 ? events : events[0]) as T;
    }
  }

  // ─── Public API Methods ───

  async createDiscussion(name: string): Promise<{ uuid: string }> {
    return this.request<{ uuid: string }>("chat/discussions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ownerId: this.projectId,
        ownerType: "PROJECT",
      }),
    });
  }

  async updateDiscussion(discussionId: string, name: string): Promise<unknown> {
    return this.request(`chat/discussions/${discussionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async uploadAttachments(
    files: File[],
    discussionId?: string,
  ): Promise<{ attachmentInfos: AttachmentInfo[] }> {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    if (discussionId) formData.append("discussionId", discussionId);

    return this.request("chat/attachments", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
    });
  }

  async postMessage(
    discussionId: string,
    question: string,
    options?: {
      attachmentInfos?: AttachmentInfo[];
      bundleId?: string;
      assistantId?: string;
      collectionIds?: string[];
    },
  ): Promise<unknown> {
    const {
      attachmentInfos = [],
      bundleId,
      assistantId,
      collectionIds,
    } = options ?? {};

    const payload: Record<string, unknown> = {
      question,
      messageId: uuidv7(),
      discussionId,
      ownerId: this.projectId,
      ownerType: "PROJECT",
    };

    if (assistantId) payload.assistantId = assistantId;

    const metadata: Record<string, unknown> = {
      feedback: "DEFAULT",
    };
    if (attachmentInfos.length > 0) metadata.attachmentInfos = attachmentInfos;
    if (bundleId) metadata.bundleId = bundleId;
    if (collectionIds?.length) metadata.collectionIds = collectionIds;
    payload.messageMetadata = metadata;

    return this.request("chat/messages/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async updateAssistant(
    assistantId: string,
    payload: {
      prompt?: string;
      name?: string;
      description?: string;
      llmBundleId?: string;
      chainOfThought?: string;
    },
  ): Promise<unknown> {
    return this.request(`assistants/${assistantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async updateAssistantJsonStructure(
    assistantId: string,
    jsonStructure: string,
  ): Promise<unknown> {
    return this.request(`assistants/${assistantId}/json_structure`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json_structure: jsonStructure }),
    });
  }

  // ─── Collections & Media Methods ───

  async listCollections(folderId: string): Promise<CollectionOut[]> {
    const folder = await this.request<{ items?: CollectionOut[] }>(
      `folders/${folderId}`,
    );
    return (folder.items ?? []).filter((item) => item.icon?.value === "Files");
  }

  async createCollection(
    name: string,
    description: string,
    folderId: string,
  ): Promise<CollectionOut> {
    return this.request<CollectionOut>("medias/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, folderId }),
    });
  }

  async getCollectionMedias(
    collectionId: string,
  ): Promise<{ uuid: string; medias: MediaOut[] }> {
    return this.request<{ uuid: string; medias: MediaOut[] }>(
      `medias/collections/${collectionId}?get_medias=true`,
    );
  }

  async uploadMedia(file: File, collectionId: string): Promise<unknown> {
    const formData = new FormData();
    formData.append("file", file, file.name);
    formData.append("media_metadata", JSON.stringify({ collectionId }));

    return this.request("medias/", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
    });
  }
}
```

### Usage Example (TypeScript)

```typescript
import { SiaGPTClient } from "./SiaGPTClient";

const client = new SiaGPTClient({
  baseUrl: "https://backend.siagpt.ai",
  projectId: process.env.SIAGPT_PROJECT_ID!,
  oauth2TokenUrl: process.env.OAUTH2_TOKEN_URL,
  oauth2ClientId: process.env.OAUTH2_CLIENT_ID,
  oauth2ClientSecret: process.env.OAUTH2_CLIENT_SECRET,
  zitadelProjectId: process.env.ZITADEL_PROJECT_ID,
});

async function main() {
  // 1. Create a discussion
  const discussion = await client.createDiscussion("My New Chat");
  console.log("Discussion ID:", discussion.uuid);

  // 2. Send a message (text-only, no attachments)
  const response = await client.postMessage(
    discussion.uuid,
    "Summarize the key risks in this scenario...",
    {
      assistantId: "your-assistant-uuid-here",
      bundleId: "your-bundle-uuid-here",
    },
  );
  console.log("Response:", response);

  // ─── Collections Flow ───

  const FOLDER_ID = process.env.SIAGPT_MEDIA_FOLDER_ID!;

  // 3. List existing collections
  const collections = await client.listCollections(FOLDER_ID);
  console.log(
    "Collections:",
    collections.map((c) => c.name),
  );

  // 4. Create a new collection (project)
  const newCollection = await client.createCollection(
    "Research Documents",
    "Documents for research analysis",
    FOLDER_ID,
  );
  console.log("Created collection:", newCollection.uuid);

  // 5. Upload a file to the collection
  const file = new File(["..."], "report.pdf", { type: "application/pdf" });
  await client.uploadMedia(file, newCollection.uuid);

  // 6. Send a message with collection context (RAG)
  const ragResponse = await client.postMessage(
    discussion.uuid,
    "What are the key findings in the uploaded report?",
    {
      assistantId: "your-assistant-uuid-here",
      collectionIds: [newCollection.uuid],
    },
  );
  console.log("RAG Response:", ragResponse);
}

main();
```

---

## 10. Client Code — Python

Production-ready Python client using `requests`. Dependencies: `requests`, `retry`.

```bash
pip install requests retry python-dotenv
```

```python
import base64
import json
import random
import struct
import time
from urllib.parse import urljoin
import requests
from retry import retry
from requests import exceptions as req_exceptions


class SiaGPTClient(requests.Session):
    """OAuth2-authenticated HTTP client for the SiaGPT API."""

    def __init__(
        self,
        oauth2_token_url: str | None,
        oauth2_client_id: str | None,
        oauth2_client_secret: str | None,
        zitadel_project_id: str | None,
        base_url: str,
        bearer_token: str | None = None,
    ):
        super().__init__()
        self.oauth2_token_url = oauth2_token_url
        self.oauth2_client_id = oauth2_client_id
        self.oauth2_client_secret = oauth2_client_secret
        self.zitadel_project_id = zitadel_project_id
        self.base_url = base_url
        self.bearer_token = bearer_token
        self.retry_connexion = False
        self._init_headers()

    def _init_headers(self):
        token = self.bearer_token or self._get_access_token()
        self.custom_headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "app-origin": "AI Platform",
        }

    def _get_access_token(self) -> str:
        if not all([
            self.oauth2_token_url,
            self.oauth2_client_id,
            self.oauth2_client_secret,
            self.zitadel_project_id,
        ]):
            raise RuntimeError("OAuth2 credentials are not configured.")

        auth_str = f"{self.oauth2_client_id}:{self.oauth2_client_secret}"
        b64_auth = base64.b64encode(auth_str.encode()).decode()

        scope_params = (
            "openid+urn:zitadel:iam:user:resourceowner+"
            f"urn:zitadel:iam:org:project:id:{self.zitadel_project_id}:aud+"
            "urn:zitadel:iam:org:projects:roles"
        )
        url = (
            f"{self.oauth2_token_url}?grant_type=client_credentials"
            f"&scope={scope_params}"
        )

        response = requests.post(url, headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {b64_auth}",
        })

        if not response.ok:
            raise RuntimeError(f"Auth failed: {response.status_code}")

        data = response.json()
        access_token = data.get("access_token")
        id_token = data.get("id_token")

        if access_token and access_token.count(".") == 2:
            return access_token
        if id_token:
            return id_token
        if access_token:
            return access_token
        raise RuntimeError("No usable token in OAuth2 response.")

    def _get_url(self, uri: str) -> str:
        return urljoin(self.base_url, uri.lstrip("/"))

    def _generate_uuid7(self) -> str:
        timestamp_ms = int(time.time() * 1000)
        rand_bytes = random.getrandbits(80).to_bytes(10, byteorder="big")
        ts_bytes = timestamp_ms.to_bytes(6, byteorder="big")
        uuid_bytes = (
            ts_bytes[:4]
            + struct.pack(">H", (ts_bytes[4] << 8 | ts_bytes[5]) & 0x0FFF | 0x7000)
            + rand_bytes[:2]
            + struct.pack(">H", (int.from_bytes(rand_bytes[2:4], "big") & 0x3FFF) | 0x8000)
            + rand_bytes[4:]
        )
        h = uuid_bytes.hex()
        return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"

    @retry(Exception, tries=5, delay=1)
    def request(self, method, url, *args, **kwargs):
        self.retry_connexion = False
        headers = self.custom_headers.copy()
        if "files" in kwargs:
            headers.pop("Content-Type", None)

        kwargs["headers"] = {**headers, **kwargs.get("headers", {})}
        kwargs["params"] = {"format": "json", **kwargs.get("params", {})}
        joined_url = self._get_url(url)

        if "timeout" not in kwargs:
            kwargs["timeout"] = (15, 600)

        try:
            response = super().request(method, joined_url, *args, **kwargs)
        except (req_exceptions.ChunkedEncodingError, req_exceptions.ConnectionError):
            time.sleep(0.5)
            response = super().request(method, joined_url, *args, **kwargs)

        if response.status_code == 401 and not self.retry_connexion and not self.bearer_token:
            self._init_headers()
            self.retry_connexion = True
            return super().request(method, joined_url, *args, **kwargs)

        return response

    def parse_response(self, response):
        if not response.ok:
            raise RuntimeError(f"Request failed ({response.status_code}): {response.text}")
        try:
            return response.json()
        except json.JSONDecodeError:
            text = response.text.strip()
            if not text:
                return {}
            events = [json.loads(line) for line in text.splitlines() if line.strip()]
            return events if len(events) > 1 else events[0] if events else {}

    # ─── Public API Methods ───

    def create_discussion(self, project_id: str, name: str):
        resp = super().post("chat/discussions", json={
            "name": name,
            "ownerId": project_id,
            "ownerType": "PROJECT",
        })
        return self.parse_response(resp)

    def update_discussion(self, discussion_id: str, *, name: str):
        resp = super().patch(f"chat/discussions/{discussion_id}", json={"name": name})
        return self.parse_response(resp)

    def upload_attachments(self, files: list, **form_fields):
        """
        files: list of (filename, content_bytes, mimetype) tuples
        form_fields: e.g. discussionId="..."
        """
        headers = {"accept": "application/json"}
        files_payload = []
        for filename, content, mimetype in files:
            files_payload.append(("files", (filename, content, mimetype)))
        resp = super().post(
            "chat/attachments",
            headers=headers,
            files=files_payload,
            data=form_fields or {},
        )
        return self.parse_response(resp)

    def post_message(
        self,
        project_id: str,
        discussion_id: str,
        question: str,
        *,
        assistant_id: str | None = None,
        bundle_id: str | None = None,
        attachment_infos: list | None = None,
        collection_ids: list[str] | None = None,
    ):
        payload = {
            "question": question,
            "messageId": self._generate_uuid7(),
            "discussionId": discussion_id,
            "ownerId": project_id,
            "ownerType": "PROJECT",
        }
        if assistant_id:
            payload["assistantId"] = assistant_id

        metadata = {"feedback": "DEFAULT"}
        if attachment_infos:
            metadata["attachmentInfos"] = attachment_infos
        if bundle_id:
            metadata["bundleId"] = bundle_id
        if collection_ids:
            metadata["collectionIds"] = collection_ids
        payload["messageMetadata"] = metadata

        resp = super().post("chat/messages/", json=payload)
        return resp  # Caller should use parse_response()

    def update_assistant(self, assistant_id: str, **kwargs):
        resp = super().patch(f"assistants/{assistant_id}", json=kwargs)
        return self.parse_response(resp)

    def update_assistant_json_structure(self, assistant_id: str, json_structure: str):
        resp = super().patch(
            f"assistants/{assistant_id}/json_structure",
            json={"json_structure": json_structure},
        )
        return self.parse_response(resp)

    # ─── Collections & Media Methods ───

    def list_collections(self, folder_id: str) -> list[dict]:
        resp = super().get(f"folders/{folder_id}")
        data = self.parse_response(resp)
        items = data.get("items", [])
        return [item for item in items if item.get("icon", {}).get("value") == "Files"]

    def create_collection(self, name: str, description: str, folder_id: str) -> dict:
        resp = super().post("medias/collections", json={
            "name": name,
            "description": description,
            "folderId": folder_id,
        })
        return self.parse_response(resp)

    def get_collection_medias(self, collection_id: str) -> dict:
        resp = super().get(f"medias/collections/{collection_id}", params={"get_medias": "true"})
        return self.parse_response(resp)

    def upload_media(self, file_path: str, collection_id: str) -> dict:
        import os
        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            resp = super().post(
                "medias/",
                headers={"accept": "application/json"},
                files=[("file", (filename, f))],
                data={"media_metadata": json.dumps({"collectionId": collection_id})},
            )
        return self.parse_response(resp)
```

### Usage Example (Python)

```python
import os
from dotenv import load_dotenv

load_dotenv()

client = SiaGPTClient(
    oauth2_token_url=os.getenv("OAUTH2_TOKEN_URL"),
    oauth2_client_id=os.getenv("OAUTH2_CLIENT_ID"),
    oauth2_client_secret=os.getenv("OAUTH2_CLIENT_SECRET"),
    zitadel_project_id=os.getenv("ZITADEL_PROJECT_ID"),
    base_url=os.getenv("SIAGPT_BASE_URL", "https://backend.siagpt.ai"),
    bearer_token=os.getenv("SIAGPT_BEARER_TOKEN"),
)

PROJECT_ID = os.getenv("SIAGPT_PROJECT_ID")

# 1. Create discussion
disc = client.create_discussion(PROJECT_ID, "Test Chat")
discussion_id = disc["uuid"]

# 2. Upload a file (optional)
with open("document.pdf", "rb") as f:
    upload_resp = client.upload_attachments(
        files=[("document.pdf", f.read(), "application/pdf")],
        discussionId=discussion_id,
    )
attachment_infos = upload_resp.get("attachmentInfos", [])

# 3. Send a message
resp = client.post_message(
    project_id=PROJECT_ID,
    discussion_id=discussion_id,
    question="Summarize this document.",
    attachment_infos=attachment_infos,
    bundle_id=os.getenv("SIAGPT_BUNDLE_ID"),
    assistant_id="your-assistant-id-here",
)
result = client.parse_response(resp)
print(result)

# ─── Collections Flow ───

FOLDER_ID = os.getenv("SIAGPT_MEDIA_FOLDER_ID")

# 4. List existing collections
collections = client.list_collections(FOLDER_ID)
print("Collections:", [c["name"] for c in collections])

# 5. Create a new collection (project)
new_collection = client.create_collection("Research Docs", "Analysis documents", FOLDER_ID)
collection_id = new_collection["uuid"]

# 6. Upload a file to the collection
client.upload_media("report.pdf", collection_id)

# 7. Send a message with collection context (RAG)
resp = client.post_message(
    project_id=PROJECT_ID,
    discussion_id=discussion_id,
    question="What are the key findings in the uploaded report?",
    assistant_id="your-assistant-id-here",
    collection_ids=[collection_id],
)
rag_result = client.parse_response(resp)
print(rag_result)
```

---

## 11. Environment Variables

### For Frontend (Vite — `VITE_` prefix required)

```env
# SiaGPT API
VITE_SIA_BASE_URL=https://backend.siagpt.ai
VITE_SIAGPT_PROJECT_ID=your-project-uuid
VITE_SIAGPT_BUNDLE_ID=your-bundle-uuid

# Auth Option 1: OAuth2
VITE_SIA_OAUTH2_TOKEN_URL=https://zitadel.heka.ai/oauth/v2/token
VITE_SIA_OAUTH2_CLIENT_ID=your-client-id
VITE_SIA_OAUTH2_CLIENT_SECRET=your-client-secret
VITE_ZITADEL_PROJECT_ID=your-zitadel-project-uuid

# Auth Option 2: Static Bearer Token (overrides OAuth2)
VITE_SIAGPT_BEARER_TOKEN=your-jwt-token

# Collections & Media (required for collections/media features)
VITE_SIAGPT_MEDIA_FOLDER_ID=your-media-folder-uuid
```

**Warning:** Exposing `VITE_SIA_OAUTH2_CLIENT_SECRET` in a frontend build is a security risk. For production, proxy through your own backend.

### For Backend (Python / Node.js)

```env
# SiaGPT API
SIAGPT_BASE_URL=https://backend.siagpt.ai
SIAGPT_PROJECT_ID=your-project-uuid
SIAGPT_BUNDLE_ID=your-bundle-uuid

# OAuth2
OAUTH2_TOKEN_URL=https://zitadel.heka.ai/oauth/v2/token
OAUTH2_CLIENT_ID=your-client-id
OAUTH2_CLIENT_SECRET=your-client-secret
ZITADEL_PROJECT_ID=your-zitadel-project-uuid

# Static Bearer Token (overrides OAuth2 if set)
SIAGPT_BEARER_TOKEN=

# Collections & Media (required for collections/media features)
SIAGPT_MEDIA_FOLDER_ID=your-media-folder-uuid
```

---

## 12. Vite Dev Proxy Setup (Frontend)

To avoid CORS issues during local development, proxy API calls through Vite:

```typescript
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      "/sia-api": {
        target: "https://backend.siagpt.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sia-api/, ""),
      },
      "/zitadel": {
        target: "https://zitadel.heka.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/zitadel/, ""),
      },
    },
  },
});
```

With this setup, use `/sia-api` as your `baseUrl` during development (e.g., `http://localhost:3000/sia-api/chat/discussions`).

---

## 13. Gotchas & Tips

1. **Scope params must be in the URL query string**, not the POST body. This is a Zitadel-specific requirement — passing them in the body returns an opaque token that SiaGPT rejects.

2. **`app-origin: AI Platform`** header is required on all API calls or requests will be rejected.

3. **Do NOT set `Content-Type` when uploading files.** Let the HTTP library set `multipart/form-data` with the correct boundary automatically. Setting it manually will break uploads.

4. **Message IDs must be UUID v7.** This ensures chronological ordering. Both the TypeScript and Python clients generate these automatically.

5. **Responses can be NDJSON.** The `/chat/messages/` endpoint may return multiple newline-delimited JSON events instead of a single JSON object. Always handle both formats.

6. **Prioritize `OVERWRITE_TEXT` events.** When parsing message responses, look for the `OVERWRITE_TEXT` event first — it contains the structured final output. Fall back to `CHAT` events for conversational responses.

7. **LLM JSON output may be malformed.** Always sanitize: strip markdown code fences, remove trailing commas, fix literal newlines inside strings.

8. **Discussions may auto-rename.** SiaGPT can rename discussions based on content. If you need a stable name, call `PATCH /chat/discussions/{id}` after each message.

9. **Token caching and 401 retry.** Cache the access token and clear + retry on 401. Tokens expire — your client should handle re-authentication gracefully.

10. **`ownerType` is always `"PROJECT"`.** This is a constant across all discussion and message API calls.

11. **Collections vs. Attachments.** Attachments (`POST /chat/attachments`) are ephemeral, per-message file uploads. Collections (`POST /medias/collections`) are persistent document stores — upload files once, reference them across many messages via `collectionIds` in `messageMetadata`.

12. **Collection identification.** When listing folder contents via `GET /folders/{folderId}`, collections are items where `icon.value === "Files"`. Other items in the folder are not collections.

13. **Media upload uses `media_metadata` as a JSON string.** The `media_metadata` form field must be a stringified JSON object (`JSON.stringify({ collectionId })`), not a raw object.

14. **Media processing is asynchronous.** After uploading, the `completion` field (0.0 to 1.0) on media objects indicates indexing progress. Wait for `completion` to reach 1.0 before expecting RAG results from that document.

15. **Presigned S3 URLs expire.** URLs from `POST /medias/versions/sources/batch` are temporary. Fetch fresh URLs each time you need to access a file.

---

## Summary of Key UUIDs

| ID                     | Purpose                       | Where Used                                         |
| ---------------------- | ----------------------------- | -------------------------------------------------- |
| **SIAGPT Project ID**  | Your data bucket in SiaGPT    | `ownerId` in discussions and messages              |
| **Zitadel Project ID** | Resource scope in auth server | OAuth2 scope string only                           |
| **Discussion ID**      | A conversation thread         | Returned by create, used in messages               |
| **Message ID**         | Unique per-message identifier | Auto-generated (UUID v7) per message               |
| **Assistant ID**       | Pre-configured AI agent       | `assistantId` in post message                      |
| **Bundle ID**          | LLM model configuration       | `messageMetadata.bundleId` in post message         |
| **Media Folder ID**    | Root folder for collections   | `folderId` in create collection, list collections  |
| **Collection ID**      | A document collection         | `collectionIds` in message metadata, media uploads |

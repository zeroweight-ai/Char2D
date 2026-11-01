# Muse API reference for agents

Use this document when implementing Muse text generation, image generation, or image editing. It reorganizes the supplied Meta Model API documentation into implementation guidance; API behavior and pricing have not been independently reverified.

Sources:

- [Model API overview / Muse Image](https://dev.meta.ai/docs/overview?team_id=2278682259649207&project_id=1658489005846745#muse-image)
- [Image generation guide](https://dev.meta.ai/docs/image-generation?team_id=2278682259649207&project_id=1658489005846745)

## 1. Choose the model and endpoint

All endpoints use the base URL `https://api.meta.ai/v1` and the API key in `MODEL_API_KEY`. Raw HTTP requests authenticate with `Authorization: Bearer <key>`.

| Task | Model | Endpoint / SDK method |
| --- | --- | --- |
| Text, reasoning, or text-model tool loops | `muse-spark-1.3` | `POST /v1/responses` / `client.responses.create` |
| Generate an image and refine it across turns | `muse-image-1.0` | `POST /v1/responses` / `client.responses.create` |
| Generate images in one request | `muse-image-1.0` | `POST /v1/images/generations` / `client.images.generate` |
| Edit or combine existing images in one request | `muse-image-1.0` | `POST /v1/images/edits` / `client.images.edit` |

Use Responses for conversation continuity. Chat Completions is an alternative for simple text requests using existing compatible code, but it does not preserve reasoning across turns.

### Shared Python client

The examples below use the OpenAI-compatible Python SDK pointed at Meta's API. They assume this client has been initialized:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.meta.ai/v1",
    api_key=os.environ["MODEL_API_KEY"],
)
```

### Implementation rules

- Select output items by `type`; never assume a fixed array position.
- For image conversations, preserve the previous response ID or the signed image-generation item ID.
- Choose one history strategy per conversation: server-managed history or manual replay.
- Resend request-level settings on each turn, including `instructions`, `tools`, and reasoning controls.
- Match saved file extensions to the requested image format. The default is WebP.
- Treat `size` as an aspect-ratio request, not a guarantee of exact output dimensions.
- Keep Muse Spark reasoning replay separate from Muse Image image replay; their input items differ.

## 2. Generate and refine images with Responses

Muse Image accepts text and optional reference images. It can generate, edit, and refine images using the same model.

### Generate and save an image

```python
import base64
from pathlib import Path

response = client.responses.create(
    model="muse-image-1.0",
    input="A red fox trotting through fresh snow, golden hour.",
    tools=[{"type": "image_generation", "output_format": "png"}],
)

images = [item for item in response.output if item.type == "image_generation_call"]
if not images:
    raise RuntimeError(f"No image returned; response status: {response.status}")

for index, item in enumerate(images):
    Path(f"fox-{index}.png").write_bytes(base64.b64decode(item.result))
```

The output can contain:

| Item type | Meaning |
| --- | --- |
| `reasoning` | Optional short summary of planning and lookups; not raw reasoning. |
| `message` | Assistant message, possibly with empty content. |
| `image_generation_call` | Generated image. `result` contains base64 bytes; `id` is a signed handle for later edits. |

There is one `image_generation_call` per returned image. Do not assume exactly three output items.

### Refine using server-managed history

Responses are stored by default (`store: true`). Send the previous response's ID and only the new instruction:

```python
refined = client.responses.create(
    model="muse-image-1.0",
    previous_response_id=response.id,
    input="Make it night, with the aurora overhead. Preserve the fox's appearance.",
    tools=[{"type": "image_generation", "output_format": "png"}],
)
```

The server reconstructs the conversation. You do not need to resend the generated image.

### Supply reference images

Use a user message containing interleaved `input_text` and `input_image` blocks. Order matters: caption each reference to explain how it should be used.

```python
response = client.responses.create(
    model="muse-image-1.0",
    input=[{
        "role": "user",
        "content": [
            {"type": "input_text", "text": "Use the pose from this image:"},
            {"type": "input_image", "image_url": "https://example.com/pose.png"},
            {"type": "input_text", "text": "Use the palette from this image:"},
            {"type": "input_image", "image_url": "data:image/png;base64,..."},
            {"type": "input_text", "text": "Produce a single painterly portrait."},
        ],
    }],
)
```

Replace placeholder URLs and base64 strings with real inputs. Each `input_image` accepts either `image_url` (a public URL or base64 data URL) or `file_id` from the Files API. You can supply multiple references and add new references in later turns.

### Refine using manual image replay

To avoid storing responses, set `store: false`. Replay the prior `image_generation_call` with its signed ID, then append the new user instruction:

```json
{
  "model": "muse-image-1.0",
  "store": false,
  "input": [
    {
      "type": "image_generation_call",
      "id": "ig_xxx_from_prior_turn",
      "status": "completed",
      "result": null
    },
    {
      "role": "user",
      "content": [
        {"type": "input_text", "text": "Make it night, with the aurora overhead."}
      ]
    }
  ]
}
```

Use the actual returned ID. Add `input_image` blocks to the new user message when introducing new references.

## 3. Control image generation

Muse Image can automatically search for visual references, look up current facts, and execute code for structured layouts. These capabilities are enabled by default. Intermediate lookups are not returned as separate tool calls. Responses may include a planning summary; the images endpoints return the finished images without that summary.

Muse Image accepts **only** the `image_generation` tool on Responses. Do not pass `web_search`, function tools, or other tools. Image search and web search are built into the model.

| Control | Default | Meaning |
| --- | --- | --- |
| `enable_image_search` | `true` | Retrieve visual references such as places, products, logos, and styles. |
| `enable_web_search` | `true` | Look up current facts. Disabling it also disables browser tools. |
| `enable_shell` | `true` | Run code to build charts, tables, or structured layouts. |
| `reasoning_strength` | `"high"` | `"high"` uses multiple refinement passes; `"low"` uses one pass for faster generation. |
| `size` | Automatic | `"WxH"`, such as `"1536x1024"`, requests an aspect ratio. Returned pixel dimensions may differ. |
| `output_format` | `"webp"` | Encoding: `"webp"`, `"png"`, or `"jpeg"`. |

For Responses, put these controls inside the tool definition. Omit `size` or use `"auto"` for the default aspect ratio:

```json
{
  "model": "muse-image-1.0",
  "input": "A watercolor fox in a snowy forest.",
  "tools": [{
    "type": "image_generation",
    "enable_image_search": false,
    "enable_web_search": false,
    "enable_shell": false,
    "reasoning_strength": "low",
    "size": "1536x1024",
    "output_format": "png"
  }]
}
```

Disable grounding tools only when the prompt does not need their references or current facts. This can reduce generation time. Lower reasoning strength changes refinement, not the per-image price.

## 4. Use the single-request images endpoints

These endpoints do not maintain conversation state. Use them for standalone generation, editing, or composition.

### Generate images

```python
import base64
from pathlib import Path

response = client.images.generate(
    model="muse-image-1.0",
    prompt="A watercolor fox sitting in a snowy pine forest.",
    n=1,
    output_format="png",
    response_format="b64_json",
)

for index, item in enumerate(response.data):
    Path(f"fox-{index}.png").write_bytes(base64.b64decode(item.b64_json))
```

| Parameter | Supported values / behavior |
| --- | --- |
| `n` | 1–10 images; default 1. |
| `size` | `"WxH"` aspect ratio; omit for the default. Does not guarantee exact pixels. |
| `response_format` | `"b64_json"` (default) or `"url"` (temporary signed download URL). |
| `output_format` | `"webp"` (default), `"png"`, or `"jpeg"`. |
| `user` | Optional stable end-user identifier. Responses uses `safety_identifier` instead. |

### Edit or combine local images with the SDK

The SDK uploads files as `multipart/form-data` using the `image` field:

```python
with open("fox.png", "rb") as image:
    edited = client.images.edit(
        model="muse-image-1.0",
        prompt="Add a small red wool hat. Keep the snowy forest background.",
        image=image,
        n=1,
        output_format="png",
    )
```

To compose multiple images, pass a list of open files:

```python
with open("fox.webp", "rb") as fox, open("mug.webp", "rb") as mug:
    composed = client.images.edit(
        model="muse-image-1.0",
        prompt="Place the fox beside the ceramic mug on a wooden table.",
        image=[fox, mug],
    )
```

### Edit using raw HTTP JSON

Meta also supports a JSON `images` array. This shape is Meta-specific; the SDK's `images.edit` method sends multipart instead.

```python
import requests

http_response = requests.post(
    "https://api.meta.ai/v1/images/edits",
    headers={
        "Authorization": f"Bearer {os.environ['MODEL_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "model": "muse-image-1.0",
        "prompt": "Add a red wool hat. Preserve the rest of the image.",
        "images": [{"image_url": "data:image/webp;base64,..."}],
        "n": 1,
    },
)
http_response.raise_for_status()
result = http_response.json()
```

Provide 1–10 image items. Each must contain exactly one of `image_url` or `file_id`. URLs may be public URLs or base64 data URLs. Use multiple items to combine references.

### Set image controls through SDK extensions

On the images endpoints, `reasoning_strength` and `tool_enablement` are top-level fields. Pass these Meta extensions through `extra_body` in the SDK:

```python
response = client.images.generate(
    model="muse-image-1.0",
    prompt="A watercolor fox in a snowy forest.",
    output_format="png",
    extra_body={
        "reasoning_strength": "low",
        "tool_enablement": {
            "enable_image_search": False,
            "enable_web_search": False,
            "enable_shell": False,
        },
    },
)
```

Omitting `tool_enablement` leaves all tools enabled.

### Read image responses and streams

Both images endpoints return this shape:

```json
{
  "created": 1784584435,
  "data": [{"b64_json": "UklGR..."}],
  "output_format": "webp",
  "background": "opaque",
  "usage": {"input_tokens": 9831, "output_tokens": 749, "total_tokens": 10580}
}
```

- `created` is a Unix timestamp in seconds.
- `data` has one entry per image, with either `b64_json` or `url`, according to `response_format`.
- `output_format` identifies the returned encoding.
- `background` is always `"opaque"`; do not assume transparent output is supported.
- `usage` reports token counts, although billing is per image.

With `stream: true`, the endpoint sends a completed SSE event containing the finished image:

| Endpoint | Completion event |
| --- | --- |
| `/v1/images/generations` | `image_generation.completed` |
| `/v1/images/edits` | `image_edit.completed` |

```text
event: image_generation.completed
data: {"type":"image_generation.completed","b64_json":"UklGR...","created_at":1784584435}
```

### Pricing in the supplied reference

The supplied documentation lists **$0.01 per successfully returned image**, regardless of reasoning strength or built-in tool use. A request returning `n` images is billed for `n` images. Failed generations and images removed by safety filtering are not counted. Built-in web and image search have no separate charge. Verify current pricing before using this figure for cost estimates.

## 5. Muse Spark and Responses conversation state

This section covers text-model Responses behavior. Do not assume every Muse Spark feature is available on Muse Image.

### Basic text request

```python
response = client.responses.create(
    model="muse-spark-1.3",
    input="What is the capital of France?",
)
print(response.output_text)
```

A response includes an `id`, `status`, `model`, typed `output` items, and `usage`. Assistant text appears inside message content blocks with `type: "output_text"`.

### Choose a history strategy

| Strategy | Request settings | What to send next turn |
| --- | --- | --- |
| Server-managed | `store: true` (default) | `previous_response_id` plus new input. |
| Stateless encrypted reasoning replay | `store: false`, `include: ["reasoning.encrypted_content"]` | Retained typed conversation items, including encrypted reasoning and tool pairs, plus new input. |

The supplied reference recommends stateless encrypted replay for multi-turn Muse Spark agents. Both strategies preserve reasoning continuity. Replaying plain messages alone does not.

Do not combine `previous_response_id` with `include: ["reasoning.encrypted_content"]`; this returns HTTP 400 (`param: "include"`). Encrypted content can otherwise be requested with either storage setting.

### Server-managed text conversation

```python
first = client.responses.create(
    model="muse-spark-1.3",
    instructions="Answer geography questions concisely.",
    input="What is the capital of France?",
)
second = client.responses.create(
    model="muse-spark-1.3",
    instructions="Answer geography questions concisely.",
    previous_response_id=first.id,
    input="What is its population?",
)
print(second.output_text)
```

`previous_response_id` carries conversation history, not request settings. Resend `instructions`, `tools`, `reasoning.effort`, and other per-request controls as needed.

`instructions` is developer-level guidance for the current request. A developer-role input message is an alternative; you do not need both. System-role content is applied at the same level as developer content in this API.

### Construct typed input manually

User messages support `input_text`, `input_image`, `input_file`, and `input_video` blocks. Replay assistant text with `output_text`:

```json
{
  "model": "muse-spark-1.3",
  "input": [
    {"role":"developer","content":[{"type":"input_text","text":"Answer concisely."}]},
    {"role":"user","content":[{"type":"input_text","text":"What is the capital of France?"}]},
    {"role":"assistant","content":[{"type":"output_text","text":"Paris."}]},
    {"role":"user","content":[{"type":"input_text","text":"What is its population?"}]}
  ]
}
```

Typed input can also contain `reasoning`, `function_call`, `function_call_output`, and replayed `web_search_call` items. A replayed `web_search_call.id` can be omitted or null; the server assigns it.

### Replay encrypted reasoning

Request encrypted reasoning explicitly:

```python
response = client.responses.create(
    model="muse-spark-1.3",
    input="Plan how to solve this task.",
    store=False,
    include=["reasoning.encrypted_content"],
)
```

A replayed reasoning item has this shape:

```json
{
  "type": "reasoning",
  "id": "rs_abc123",
  "summary": [],
  "encrypted_content": "..."
}
```

- Replay the actual returned encrypted content unchanged.
- `summary` is required on input; use `[]` when there is no summary.
- `id` is generated on output but optional on replay when encrypted content is present.
- A bare reasoning ID is insufficient and can produce HTTP 400 for a missing or expired item.
- Responses messages do not use `reasoning_content`; that field belongs to Chat Completions.

### Preserve ordering, phases, and tool pairs

Manual replay is validated. Follow these rules:

1. After a reasoning item, include an assistant message or `function_call` before any new user, system, or developer message. If a turn contains reasoning only, insert a minimal assistant message before the next user turn.
2. Preserve `function_call` / `function_call_output` pairs. Without `previous_response_id`, each output's `call_id` must match a call in the same request. A `call_id` must contain 1–64 characters.
3. Preserve `phase: "commentary"` on intermediate assistant messages preceding tool calls. Replaying that text as an ordinary final answer immediately before a function call returns HTTP 400.
4. Preserve unique item IDs when retaining history.

Assistant phase behavior:

| Phase | Meaning |
| --- | --- |
| `"commentary"` | Intermediate assistant content, such as a preamble before a tool call. Preserve on replay. |
| No phase | Treat as final answer content. |
| `"final_answer"` | Accepted on input only; the model does not emit it. |

These ordering checks are relaxed with `previous_response_id` because the server reconstructs stored history.

### Compact long conversations

The API does not automatically trim context. `truncation: "auto"` is rejected; only `"disabled"` is supported. Over-context requests return HTTP 400.

- Compact whole turns while preserving valid message ordering and tool pairs.
- Keep recent encrypted reasoning for active tool loops. Older reasoning can be dropped, at the cost of losing that turn's reasoning context.
- Encrypted items are opaque: retain them intact or drop them; do not summarize or rewrite them.
- Every retained reasoning item needs its encrypted content, even if it has an ID.
- Measure the trimmed request with `POST /v1/responses/input_tokens` before generation.

Server-managed history avoids manual reconstruction, but should not be assumed to remove context-window limits.

## 6. Responses streaming and lifecycle

### Stream the initial request

```python
with client.responses.stream(
    model="muse-spark-1.3",
    input="Explain how neural networks learn.",
) as stream:
    for event in stream:
        if event.type == "response.output_text.delta":
            print(event.delta, end="", flush=True)
print()
```

Streaming supports `previous_response_id`. Keep the response ID for subsequent turns.

Common events include:

- Lifecycle: `response.created`, `response.in_progress`, `response.completed`, `response.failed`.
- Output: `response.output_item.added`, `response.output_item.done`, `response.content_part.added`, `response.content_part.done`, `response.output_text.delta`.
- Tool arguments: `response.function_call_arguments.delta`, `response.function_call_arguments.done`.
- Requested reasoning summaries: `response.reasoning_summary_text.delta` and `.done`.

Muse Spark does not emit raw reasoning text or `response.reasoning_text.*` events. Raw reasoning is available only as encrypted replay content. Message and function-call item statuses progress from `in_progress` to `completed`; retain items until completion.

The final streamed response includes `usage`; `stream_options.include_usage` is a Chat Completions setting and is unnecessary here. A failed stream ends with `response.failed`, containing a failed response and error object.

Non-streaming requests can hit a server time limit and return HTTP 504 (`gateway_timeout`). For long workloads, use streaming or background execution.

### Retrieve and run in the background

```python
stored = client.responses.retrieve("resp_abc123")

pending = client.responses.create(
    model="muse-spark-1.3",
    input="Analyze this long task.",
    background=True,
)
# The immediate acknowledgement has background=true and status="queued".
# Poll client.responses.retrieve(pending.id) for progress and completion.
```

Background rules:

- Do not combine `background: true` and `stream: true` on creation; this returns HTTP 400.
- Background creation is rate-limited per team.
- The creation body is limited to 1 MiB (1,048,576 bytes); larger bodies return HTTP 413. Use uploaded `file_id` references instead of large inline base64 inputs. The ordinary inline-media limit cited in the source is 50 MB.
- Retrieve with `GET /v1/responses/{id}?stream=true` to live-tail lifecycle events.
- Retrieval streams emit `response.created`, a terminal event (`response.completed`, `response.failed`, or `response.incomplete`), then `[DONE]`. They do not replay token deltas.
- Use `starting_after` to resume after a sequence number; events at or below that number are skipped.

Retrieved responses retain request parameters, output, and usage details, including reasoning and cached-token counts. `completed_at` is populated only for `status: "completed"`. Visible commentary counts toward output tokens, but not reasoning-token counts.

### Persistence and transient lookup failures

With `store: true`, streamed responses continue processing and persist even if the client disconnects. You can retrieve or reference them afterward.

Persistence normally precedes `response.completed`. Under load or during deployment, a just-completed response may briefly return HTTP 404 on retrieval or HTTP 400 when chained. Retry once or twice with a short backoff for this specific situation.

### Cancel or delete

```python
current = client.responses.cancel("resp_abc123")
```

Cancel applies to background responses. It returns the current state if completion, failure, or cancellation has already occurred. A deleted response returns HTTP 404. If cancellation returns `status: "completed"` with empty output, retrieve the response to read its result.

Delete with `DELETE /v1/responses/{response_id}`. Deletion is soft: the response can no longer be retrieved or used as `previous_response_id`. Repeating the deletion returns HTTP 404, not another success.

## 7. Muse Spark settings and compatibility

| Setting / feature | Guidance |
| --- | --- |
| Search grounding | Add `tools=[{"type": "web_search"}]` for Muse Spark. Do not add this tool for Muse Image. |
| Files and visual inputs | Upload files and use `input_file` / `input_image` references; image data URLs are also supported. |
| `reasoning.effort` | Accepted values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. Muse Spark rejects `none`; omitting the field enables default reasoning. Chat Completions uses `reasoning_effort`. |
| `temperature`, `top_p` | Defaults are 1.0 and 1.0; leave unset for most workloads. If tuning, change one at a time. |
| `max_output_tokens` | Includes reasoning and visible output; minimum 16. Input tokens plus this budget must fit the context window, and the budget must not exceed the model's output maximum. |
| Structured output | Use `text.format` on Responses. `response_format` does not configure structured output there. |
| `prompt_cache_retention` | `"in_memory"` or `"24h"` is a hint; actual retention is server-managed. |
| `prompt_cache_key` | Group requests for cache efficiency. |
| `include` | Requests optional fields. Unknown values return HTTP 400; an accepted value may still be unsupported by the model. |
| Log probabilities | Unsupported by Muse Spark. `include: ["message.output_text.logprobs"]` returns HTTP 400; no top-level `logprobs` parameter is accepted. |
| Sampling penalties | Omit `frequency_penalty` and `presence_penalty`; unsupported and may error. |

Omit unimplemented Responses parameters: `stop`, `verbosity`, `logit_bias`, `prediction`, `n > 1`, audio modalities, and `web_search_options`. Some may be accepted for compatibility without effect. The images endpoints separately support `n` from 1 to 10.

### Identify end users

On Responses and Chat Completions, use `safety_identifier`: an optional stable, privacy-preserving identifier of at most 64 characters, such as a hash of an internal user ID. Avoid sending usernames or emails.

`safety_identifier` supersedes the deprecated `user` field when both are sent. For the images endpoints use `user`; the Messages API equivalent is `metadata.user_id`.

## 8. Image validation and error handling

Validation errors use an OpenAI-style envelope:

```json
{
  "error": {
    "type": "invalid_request_error",
    "param": "n",
    "message": "`n` The number must be `<= 10`."
  }
}
```

| Condition | Result / action |
| --- | --- |
| Missing, empty, or overlong prompt | HTTP 400, `param: "prompt"`. Correct the prompt. |
| Empty model | HTTP 400, `param: "model"`. |
| `n` outside 1–10 | HTTP 400. |
| Invalid `response_format` or `output_format` | HTTP 400. Use supported values. |
| Size aspect ratio beyond 16:1 | HTTP 400, `param: "size"`. |
| Unknown top-level JSON field, such as `seed` | HTTP 400 naming the field. Unknown edit-image members are also rejected. Unknown nested keys in other request objects are ignored. |
| Incorrect JSON Content-Type | HTTP 415, `code: "unsupported_media_type"`. Use `application/json`; an absent header is treated as JSON. |
| Empty/malformed edit inputs | HTTP 400. Supply 1–10 items, each with exactly one of `image_url` or `file_id`. |
| Fetched edit URL is not `image/*` | HTTP 400, `param: "images[i].image_url"`. |
| Unsupported Responses tool for Muse Image | HTTP 400: `"image models only support the image_generation tool"`. |
| Content safety block | HTTP 400, `code: "content_policy_violation"`, `param: "prompt"`. |
| Explicitly retryable generation failure | HTTP 503, `type: "server_error"`. Retry with backoff. |
| Other backend failure | HTTP 500, including unclassified errors or missing structured errors. |

Multipart edit rules:

- Send each scalar field once.
- Use either `image` or numbered `image[N]` fields consistently; do not mix them. Numbered fields start at 0.
- `mask`, `input_fidelity`, and `partial_images` return HTTP 400 (`code: "unsupported_parameter"`).
- Other unrecognized multipart fields are ignored.

`moderation` support depends on the model. In the supplied reference, `muse-image-1.0` does not support it: any value returns HTTP 400 (`code: "unsupported_parameter"`, `param: "moderation"`). Omit it. Where enabled, the accepted values are `"auto"` and `"low"`; empty or unknown values return HTTP 400.

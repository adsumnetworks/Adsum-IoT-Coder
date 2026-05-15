import json
from pathlib import Path

# ── CHANGE THIS ──────────────────────────────────────────────────────────────
JSONL = '/home/{user}/.claude/projects/{project}/{session_id}.jsonl'
MODEL_MAX_CONTEXT = 200_000
# ─────────────────────────────────────────────────────────────────────────────

total_input        = 0
total_cache_create = 0
total_cache_read   = 0
total_output       = 0
peak_ctx           = 0
west_flash_count   = 0

with open(JSONL, encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue

        usage = (obj.get('message') or {}).get('usage') or {}

        inp  = usage.get('input_tokens', 0)
        cc   = usage.get('cache_creation_input_tokens', 0)
        cr   = usage.get('cache_read_input_tokens', 0)
        out  = usage.get('output_tokens', 0)

        total_input        += inp
        total_cache_create += cc
        total_cache_read   += cr
        total_output       += out

        ctx_this_request = inp + cc + cr
        if ctx_this_request > peak_ctx:
            peak_ctx = ctx_this_request

        # count west flash calls in assistant text
        content = (obj.get('message') or {}).get('content') or []
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = block.get('text') or ''
                    west_flash_count += text.count('west flash')

total_tok = total_input + total_cache_create + total_cache_read + total_output
ctx_pct   = round(peak_ctx / MODEL_MAX_CONTEXT * 100, 1)

print("=" * 45)
print(f"  TOK (total session)  : {total_tok:,}")
print(f"    input              : {total_input:,}")
print(f"    cache_creation     : {total_cache_create:,}")
print(f"    cache_read         : {total_cache_read:,}")
print(f"    output             : {total_output:,}")
print(f"  CTX% (peak)          : {ctx_pct}%  ({peak_ctx:,} / {MODEL_MAX_CONTEXT:,})")
print(f"  west flash count (k) : {west_flash_count}")
print("=" * 45)
print(f"\nBenchmark cell: TOK={total_tok:,} / CTX={ctx_pct}%")
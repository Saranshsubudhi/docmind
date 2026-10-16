/**
 * Removes `<tag>…</tag>` blocks from a token stream — reasoning (`<think>`)
 * and tool calls some models write as plain text (`<tool_call>`). Tags may be
 * split across chunks, so a possible partial tag at the end is held back
 * until the next chunk arrives.
 */
export class HiddenBlockFilter {
  private buffer = "";
  /** Closing tag of the block we're inside, or null when outside. */
  private closeTag: string | null = null;
  private afterBlock = false;
  private readonly openTags: string[];

  constructor(tags: string[] = ["think", "tool_call"]) {
    this.openTags = tags.map((t) => `<${t}>`);
  }

  push(text: string): string {
    this.buffer += text;
    let out = "";

    while (this.buffer) {
      if (this.closeTag) {
        const end = this.buffer.indexOf(this.closeTag);
        if (end === -1) {
          // Drop hidden text, but keep a possible partial closing tag.
          this.buffer = this.buffer.slice(this.buffer.length - partialTagLength(this.buffer, [this.closeTag]));
          break;
        }
        this.buffer = this.buffer.slice(end + this.closeTag.length);
        this.closeTag = null;
        this.afterBlock = true;
        continue;
      }

      if (this.afterBlock) {
        // Skip the whitespace models put after a hidden block.
        this.buffer = this.buffer.replace(/^\s+/, "");
        if (!this.buffer) break;
        this.afterBlock = false;
      }

      const next = this.findOpenTag();
      if (!next) {
        const hold = partialTagLength(this.buffer, this.openTags);
        out += this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        break;
      }
      out += this.buffer.slice(0, next.index);
      this.buffer = this.buffer.slice(next.index + next.tag.length);
      this.closeTag = `</${next.tag.slice(1)}`;
    }

    return out;
  }

  /** Emit anything held back once the stream ends. */
  flush(): string {
    const rest = this.closeTag ? "" : this.buffer;
    this.buffer = "";
    this.closeTag = null;
    return rest;
  }

  private findOpenTag(): { index: number; tag: string } | null {
    let best: { index: number; tag: string } | null = null;
    for (const tag of this.openTags) {
      const index = this.buffer.indexOf(tag);
      if (index !== -1 && (!best || index < best.index)) best = { index, tag };
    }
    return best;
  }
}

/** Length of the longest suffix of `text` that is a proper prefix of any tag. */
function partialTagLength(text: string, tags: string[]): number {
  let longest = 0;
  for (const tag of tags) {
    for (let len = Math.min(tag.length - 1, text.length); len > longest; len--) {
      if (tag.startsWith(text.slice(-len))) {
        longest = len;
        break;
      }
    }
  }
  return longest;
}

import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";

/**
 * Embeddings for NVIDIA's hosted retrieval models (build.nvidia.com), e.g.
 * `nvidia/nemotron-3-embed-1b`.
 *
 * The endpoint is OpenAI-shaped, but these models are asymmetric and require
 * `input_type` ("passage" for documents, "query" for searches), which
 * OpenAIEmbeddings can't send.
 */
export type NvidiaEmbeddingsParams = EmbeddingsParams & {
  apiKey: string;
  model: string;
  baseURL?: string;
  /** Texts per request. */
  batchSize?: number;
};

type EmbeddingResponse = { data: { index: number; embedding: number[] }[] };

export class NvidiaEmbeddings extends Embeddings {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly batchSize: number;

  constructor({ apiKey, model, baseURL, batchSize = 32, ...rest }: NvidiaEmbeddingsParams) {
    super(rest);
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = (baseURL ?? "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
    this.batchSize = batchSize;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < documents.length; i += this.batchSize) {
      vectors.push(...(await this.embed(documents.slice(i, i + this.batchSize), "passage")));
    }
    return vectors;
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.embed([query], "query");
    return vector;
  }

  private embed(input: string[], inputType: "passage" | "query"): Promise<number[][]> {
    return this.caller.call(async () => {
      const response = await fetch(`${this.baseURL}/embeddings`, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input,
          input_type: inputType,
          encoding_format: "float",
          // Cut over-long chunks instead of failing the whole batch.
          truncate: "END",
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`NVIDIA embeddings request failed (${response.status}): ${detail.slice(0, 300)}`);
      }
      const { data } = (await response.json()) as EmbeddingResponse;
      return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    });
  }
}

import { eq } from "drizzle-orm";
import { db } from "../db";
import { searchStateSchema } from "../db/schema";

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function getSearchState() {
  const [state] = await db.select().from(searchStateSchema).limit(1);
  return state || { regionIndex: 0, pageIndex: 0, nextPageToken: null };
}

export async function updateSearchState(
  regionIndex: number,
  pageIndex: number,
  nextPageToken?: string | null
) {
  const [existing] = await db.select().from(searchStateSchema).limit(1);

  if (existing) {
    await db
      .update(searchStateSchema)
      .set({
        regionIndex,
        pageIndex,
        nextPageToken: nextPageToken || null,
        updatedAt: new Date(),
      })
      .where(eq(searchStateSchema.id, existing.id));
  } else {
    await db.insert(searchStateSchema).values({
      regionIndex,
      pageIndex,
      nextPageToken: nextPageToken || null,
    });
  }
}

export async function exponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 10,
  initialDelay = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        throw lastError;
      }

      const delay = initialDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 0.1 * delay;
      const totalDelay = delay + jitter;

      console.log(
        `Attempt ${attempt + 1} failed, retrying in ${Math.round(totalDelay)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, totalDelay));
    }
  }

  throw lastError!;
}

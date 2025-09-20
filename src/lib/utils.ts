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

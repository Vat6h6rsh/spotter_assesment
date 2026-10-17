import type { Checkpoint } from "../api/types";
import { number } from "./fmt";

/** Older offline snapshots have no place enrichment. */
export const checkpointPlaceLabel = (cp: Checkpoint) =>
  cp.place_label?.trim() || `Mile ${number(cp.mi)}`;
